import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { createRequestSchema, stockReleaseSchema, createExtensionSchema, insertUserSchema, emailLogs, emailPreferences, requests, requestItems, notifications, approvals, branches, requestExtensions, adminWarehouses, stockReleases, stockReleaseItems } from "@shared/schema";
import { desc, eq, ne, and, sql, ilike, inArray } from "drizzle-orm";
import { db } from "./storage";
import { sendOrderEmail, collectRecipients, type EmailEventType } from "./email";
import { objectStorageClient } from "./object_storage/objectStorage";

const JWT_SECRET = process.env.SESSION_SECRET || "inventory-system-secret-key";

// Legacy local upload dir (for backward compatibility with old files)
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Object Storage bucket for file uploads
// PRIVATE_OBJECT_DIR format: /<bucket_id>/<path_within_bucket>  e.g. /<bucket>/.private
const BUCKET_NAME = (process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "").trim();
const _rawPrivateDir = (process.env.PRIVATE_OBJECT_DIR || "").trim();
// Extract the path portion within the bucket (strip leading /<bucketName>/)
const PRIVATE_OBJECT_PATH = BUCKET_NAME && _rawPrivateDir.startsWith(`/${BUCKET_NAME}/`)
  ? _rawPrivateDir.slice(`/${BUCKET_NAME}/`.length)
  : ".private";

async function uploadFileToObjectStorage(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<string> {
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const ext = path.extname(originalName);
  const filename = uniqueSuffix + ext;
  // objectPath is the path within the bucket
  const objectPath = `${PRIVATE_OBJECT_PATH}/uploads/${filename}`;

  const bucket = objectStorageClient.bucket(BUCKET_NAME);
  const file = bucket.file(objectPath);
  await file.save(fileBuffer, { metadata: { contentType: mimeType } });
  // Return a URL we serve from our own endpoint
  return `/cloud-uploads/${BUCKET_NAME}/${objectPath}`;
}

// Multer using memory storage (buffer) so we can upload to Object Storage
const memStorage = multer.memoryStorage();

const upload = multer({
  storage: memStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedExcel = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const allowedPO = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      ...allowedExcel,
    ];
    if (file.fieldname === "excel") {
      cb(null, allowedExcel.includes(file.mimetype));
    } else if (file.fieldname === "purchaseOrder") {
      cb(null, allowedPO.includes(file.mimetype));
    } else {
      cb(null, true);
    }
  },
});

function generateToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    (req as any).userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

async function getAuthUser(req: Request) {
  const userId = (req as any).userId;
  return storage.getUser(userId);
}

function roleMiddleware(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (roles.length > 0 && !roles.includes(user.role) && user.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }
    (req as any).user = user;
    next();
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  async function getBranchManagerUserIds(targetBranchId: number, allUsers: any[]): Promise<number[]> {
    const allUserBranchLinks = await storage.getAllUserBranches();
    const userBranchMap = new Map<number, number[]>();
    for (const link of allUserBranchLinks) {
      if (!userBranchMap.has(link.userId)) userBranchMap.set(link.userId, []);
      userBranchMap.get(link.userId)!.push(link.branchId);
    }
    return allUsers
      .filter(u => u.role === "branch_manager" && (userBranchMap.get(u.id)?.includes(targetBranchId) || u.branchId === targetBranchId))
      .map(u => u.id);
  }

  app.post("/api/admin/fix-extensions/:requestId", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const requestId = parseInt(String(req.params.requestId));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const exts = await db.select().from(requestExtensions).where(eq(requestExtensions.requestId, requestId)).orderBy(desc(requestExtensions.createdAt));
      const pendingStatuses = ["pending_branch", "pending_category", "pending_planning", "pending_sector_head"];
      const approvedExts = exts.filter(e => e.status === "approved");
      const pendingExts = exts.filter(e => pendingStatuses.includes(e.status));

      const rejectedCount = await db.transaction(async (tx) => {
        let count = 0;
        for (const pe of pendingExts) {
          await tx.update(requestExtensions)
            .set({ status: "rejected" as any, rejectionReason: "Admin cleanup: duplicate extensions resolved" })
            .where(eq(requestExtensions.id, pe.id));
          count++;
        }
        if (approvedExts.length > 0) {
          const latestApproved = approvedExts[0];
          await tx.update(requests).set({
            reservationEndDate: latestApproved.newExpiryDate,
            status: "final_approved",
            updatedAt: new Date(),
          }).where(eq(requests.id, requestId));
        }
        return count;
      });

      res.json({
        message: `Fixed: rejected ${rejectedCount} pending, applied approved extension`,
        approvedCount: approvedExts.length,
        rejectedCount,
        newEndDate: approvedExts[0]?.newExpiryDate,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/orphaned-releases", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const orphanedQuery = await db.execute(sql`
        SELECT sri.id as sri_id, sri.request_item_id as old_item_id, sri.quantity, sri.stock_release_id,
               sr.request_id, sr.status as release_status
        FROM stock_release_items sri
        JOIN stock_releases sr ON sr.id = sri.stock_release_id
        LEFT JOIN request_items ri ON ri.id = sri.request_item_id
        WHERE ri.id IS NULL
        ORDER BY sr.request_id, sri.request_item_id
      `);
      const orphaned = orphanedQuery.rows as any[];
      const affectedRequestIds = [...new Set(orphaned.map(o => o.request_id))];

      const requestSummaries: any[] = [];
      for (const reqId of affectedRequestIds) {
        const reqOrphans = orphaned.filter(o => o.request_id === reqId);
        const distinctOldIds = [...new Set(reqOrphans.map(o => o.old_item_id))].sort((a: number, b: number) => a - b);

        const currentItems = await db.select().from(requestItems).where(eq(requestItems.requestId, reqId));

        const logsResult = await db.execute(sql`
          SELECT old_data, action, created_at FROM audit_logs
          WHERE entity = 'request' AND entity_id = ${String(reqId)}
          AND (action LIKE '%edit%' OR action LIKE '%resubmit%')
          ORDER BY created_at ASC LIMIT 1
        `);
        let snapshotItemCount = 0;
        let snapshotCodes: string[] = [];
        if (logsResult.rows.length > 0) {
          const oldData = typeof (logsResult.rows[0] as any).old_data === 'string'
            ? JSON.parse((logsResult.rows[0] as any).old_data)
            : (logsResult.rows[0] as any).old_data;
          if (oldData?.items) {
            snapshotItemCount = oldData.items.length;
            snapshotCodes = oldData.items.map((i: any) => i.itemCode);
          }
        }

        requestSummaries.push({
          requestId: reqId,
          orphanedReleaseItems: reqOrphans.length,
          distinctOldItemIds: distinctOldIds.length,
          oldItemIdRange: `${Math.min(...distinctOldIds)}-${Math.max(...distinctOldIds)}`,
          currentItemCount: currentItems.length,
          snapshotItemCount,
          canAutoFix: snapshotItemCount > 0 && snapshotItemCount >= distinctOldIds.length,
        });
      }

      res.json({
        totalOrphaned: orphaned.length,
        affectedRequests: affectedRequestIds.length,
        requests: requestSummaries,
        orphanedDetails: orphaned,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/fix-orphaned-releases", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const dryRun = req.query.dryRun === "true";

      const orphanedQuery = await db.execute(sql`
        SELECT sri.id as sri_id, sri.request_item_id as old_item_id, sri.quantity, sri.stock_release_id,
               sr.request_id, sr.status as release_status
        FROM stock_release_items sri
        JOIN stock_releases sr ON sr.id = sri.stock_release_id
        LEFT JOIN request_items ri ON ri.id = sri.request_item_id
        WHERE ri.id IS NULL
        ORDER BY sr.request_id, sri.request_item_id
      `);
      const orphaned = orphanedQuery.rows as any[];
      if (orphaned.length === 0) {
        return res.json({ message: "No orphaned release items found", fixed: 0 });
      }

      const affectedRequestIds = [...new Set(orphaned.map(o => o.request_id))];
      const oldIdToItemCode = new Map<number, string>();

      for (const reqId of affectedRequestIds) {
        const logsResult = await db.execute(sql`
          SELECT old_data, new_data, created_at FROM audit_logs
          WHERE entity = 'request' AND entity_id = ${String(reqId)}
          AND (action LIKE '%edit%' OR action LIKE '%resubmit%')
          ORDER BY created_at ASC
        `);

        const allSnapshots: any[][] = [];
        for (const log of logsResult.rows as any[]) {
          const oldData = typeof log.old_data === 'string' ? JSON.parse(log.old_data) : log.old_data;
          if (oldData?.items && Array.isArray(oldData.items)) allSnapshots.push(oldData.items);
        }

        const reqOrphans = orphaned.filter(o => o.request_id === reqId);
        const distinctOldIds = [...new Set(reqOrphans.map(o => o.old_item_id))].sort((a: number, b: number) => a - b);

        const generations: number[][] = [[distinctOldIds[0]]];
        for (let i = 1; i < distinctOldIds.length; i++) {
          if (distinctOldIds[i] - distinctOldIds[i - 1] > 50) {
            generations.push([distinctOldIds[i]]);
          } else {
            generations[generations.length - 1].push(distinctOldIds[i]);
          }
        }

        for (const genIds of generations) {
          const maxId = Math.max(...genIds);
          for (const snapshot of allSnapshots) {
            const startId = maxId - snapshot.length + 1;
            const allInRange = genIds.every(id => {
              const pos = id - startId;
              return pos >= 0 && pos < snapshot.length;
            });
            if (allInRange) {
              for (const oldId of genIds) {
                const pos = oldId - startId;
                if (!oldIdToItemCode.has(oldId)) {
                  oldIdToItemCode.set(oldId, snapshot[pos].itemCode);
                }
              }
              break;
            }
          }
        }
      }

      let fixedCount = 0;
      let skippedCount = 0;
      const fixDetails: any[] = [];

      for (const orphan of orphaned) {
        const { sri_id, old_item_id, quantity, request_id } = orphan;
        const itemCode = oldIdToItemCode.get(old_item_id);

        if (!itemCode) {
          skippedCount++;
          fixDetails.push({ sri_id, old_item_id, request_id, status: "skipped", reason: "could not determine item_code" });
          continue;
        }

        const currentItems = await db.select().from(requestItems)
          .where(and(eq(requestItems.requestId, request_id), eq(requestItems.itemCode, itemCode)));

        if (currentItems.length === 0) {
          skippedCount++;
          fixDetails.push({ sri_id, old_item_id, itemCode, request_id, status: "skipped", reason: "no matching current item" });
          continue;
        }

        const targetItem = currentItems[0];

        if (!dryRun) {
          await db.execute(sql`
            UPDATE stock_release_items SET request_item_id = ${targetItem.id} WHERE id = ${sri_id}
          `);
        }
        fixedCount++;
        fixDetails.push({ sri_id, old_item_id, itemCode, newItemId: targetItem.id, request_id, status: dryRun ? "would_fix" : "fixed" });
      }

      if (!dryRun) {
        const updatedRequestIds = [...new Set(fixDetails.filter(d => d.status === "fixed").map(d => d.request_id))];
        for (const reqId of updatedRequestIds) {
          const items = await db.select().from(requestItems).where(eq(requestItems.requestId, reqId));
          for (const item of items) {
            const totalReleased = await db.execute(sql`
              SELECT COALESCE(SUM(sri2.quantity), 0) as total
              FROM stock_release_items sri2
              JOIN stock_releases sr2 ON sr2.id = sri2.stock_release_id
              WHERE sri2.request_item_id = ${item.id}
                AND sr2.status = 'final_approved'
            `);
            const releasedQty = Number((totalReleased.rows[0] as any).total);
            await db.update(requestItems).set({
              quantityReleased: releasedQty,
              status: releasedQty >= item.quantityRequested ? "fully_released" : releasedQty > 0 ? "partially_released" : "pending",
            }).where(eq(requestItems.id, item.id));
          }
        }
      }

      res.json({
        mode: dryRun ? "DRY_RUN" : "EXECUTED",
        message: `${dryRun ? "Would fix" : "Fixed"} ${fixedCount} orphaned release items, skipped ${skippedCount}`,
        fixedCount,
        skippedCount,
        totalOrphaned: orphaned.length,
        details: fixDetails,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message, stack: err.stack });
    }
  });

  // Serve files from Object Storage (new persistent storage)
  // URL format: /cloud-uploads/BUCKET_ID/path/to/file.pdf?token=...
  app.get(/^\/cloud-uploads\/([^/]+)\/(.+)$/, async (req, res) => {
    try {
      let token = "";
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      } else if (req.query.token) {
        token = req.query.token as string;
      }
      if (!token) return res.status(401).json({ message: "Unauthorized" });
      try { jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ message: "Invalid token" }); }

      const match = req.path.match(/^\/cloud-uploads\/([^/]+)\/(.+)$/);
      if (!match) return res.status(404).send("File not found");
      const bucketName = match[1];
      const objectPath = match[2];
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectPath);
      const [exists] = await file.exists();
      if (!exists) return res.status(404).send("File not found");
      const [metadata] = await file.getMetadata();
      res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
      file.createReadStream().pipe(res);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Legacy route - serve old files from local disk (backward compatibility)
  app.get("/uploads/:filename", async (req, res) => {
    try {
      let token = "";
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      } else if (req.query.token) {
        token = req.query.token as string;
      }
      if (!token) return res.status(401).json({ message: "Unauthorized" });
      try { jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ message: "Invalid token" }); }

      const filename = req.params.filename;
      const filePath = path.resolve(uploadDir, filename);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return res.sendFile(filePath);
      }
      res.status(404).send("File not found");
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const token = generateToken(user.id);
      const { password: _, ...safeUser } = user;
      res.json({ token, user: safeUser });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/change-password", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }

      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashedPassword });

      res.json({ message: "Password changed successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dashboard", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const branchIds = user.role === "branch_manager" ? await storage.getUserBranchIds(user.id, user.branchId) : [];
      const stats = await storage.getDashboardStats(user.id, user.role, user.branchId, branchIds, user.productCategoryId);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin settings: Departments
  app.get("/api/admin/departments", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const depts = await storage.getDepartments();
      res.json(depts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/departments", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name, branchIds } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Department name is required" });
      }
      const parsedBranchIds = Array.isArray(branchIds) ? branchIds.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id)) : [];
      const dept = await storage.createDepartment(name.trim(), parsedBranchIds);
      const deptBranchIds = await storage.getDepartmentBranches(dept.id);
      res.json({ ...dept, branchIds: deptBranchIds });
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        return res.status(400).json({ message: "Department already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/departments/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name, branchIds } = req.body;
      const updateData: { name?: string; branchIds?: number[] } = {};
      if (name !== undefined) updateData.name = name.trim();
      if (branchIds !== undefined) {
        updateData.branchIds = Array.isArray(branchIds) ? branchIds.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id)) : [];
      }
      const dept = await storage.updateDepartment(parseInt(String(req.params.id)), updateData);
      const deptBranchIds = await storage.getDepartmentBranches(dept.id);
      res.json({ ...dept, branchIds: deptBranchIds });
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        return res.status(400).json({ message: "Department already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/departments/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteDepartment(parseInt(String(req.params.id)));
      res.json({ message: "Deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin settings: Warehouses
  app.get("/api/admin/warehouses", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const warehouses = await storage.getWarehouses();
      const usedRows = await db.selectDistinct({ warehouse: requestItems.warehouse }).from(requestItems).where(sql`${requestItems.warehouse} IS NOT NULL AND ${requestItems.warehouse} != ''`);
      const existingNames = new Set(warehouses.map(w => w.name));
      const merged = [...warehouses];
      for (const row of usedRows) {
        const name = (row.warehouse || "").trim();
        if (name && !existingNames.has(name)) {
          existingNames.add(name);
          merged.push({ id: 0, name, location: null });
        }
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));
      res.json(merged);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/warehouses", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name, location } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Warehouse name is required" });
      }
      const wh = await storage.createWarehouse(name.trim(), location?.trim());
      res.json(wh);
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        return res.status(400).json({ message: "Warehouse already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/warehouses/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name, location } = req.body;
      const updateData: { name?: string; location?: string } = {};
      if (name !== undefined) updateData.name = name.trim();
      if (location !== undefined) updateData.location = location.trim();
      const wh = await storage.updateWarehouse(parseInt(String(req.params.id)), updateData);
      res.json(wh);
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        return res.status(400).json({ message: "Warehouse already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/warehouses/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteWarehouse(parseInt(String(req.params.id)));
      res.json({ message: "Deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/product-categories", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const categories = await storage.getProductCategories();
      res.json(categories);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/product-categories", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      const cat = await storage.createProductCategory(name.trim());
      res.status(201).json(cat);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        return res.status(409).json({ message: "Category already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/product-categories/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      const cat = await storage.updateProductCategory(parseInt(String(req.params.id)), name.trim());
      res.json(cat);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/product-categories/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteProductCategory(parseInt(String(req.params.id)));
      res.json({ message: "Deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/products", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const search = (req.query.search as string) || undefined;
      const result = await storage.getProductsPaginated({ page, limit, search });
      if (user && (user.role === "sales_rep" || user.role === "branch_manager")) {
        const sanitizedProducts = result.products.map((p: any) => {
          const { costPrice, ...rest } = p;
          return rest;
        });
        return res.json({ ...result, products: sanitizedProducts });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/products/lookup/:code", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const product = await storage.getProductByCode(String(req.params.code));
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      const filterCategoryId = req.query.productCategoryId ? parseInt(req.query.productCategoryId as string) : null;
      if (filterCategoryId && product.productCategoryId !== filterCategoryId) {
        return res.status(404).json({ message: "Product not found in selected category", categoryMismatch: true });
      }
      if (user && (user.role === "sales_rep" || user.role === "branch_manager")) {
        const { costPrice, ...rest } = product as any;
        return res.json(rest);
      }
      res.json(product);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/products", authMiddleware, roleMiddleware("admin", "planning"), async (req: Request, res: Response) => {
    try {
      const product = await storage.createProduct(req.body);
      res.status(201).json(product);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        return res.status(409).json({ message: "Item code already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/products/:id", authMiddleware, roleMiddleware("admin", "planning"), async (req: Request, res: Response) => {
    try {
      const product = await storage.updateProduct(parseInt(String(req.params.id)), req.body);
      res.json(product);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        return res.status(409).json({ message: "Item code already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/products/:id", authMiddleware, roleMiddleware("admin", "planning"), async (req: Request, res: Response) => {
    try {
      await storage.deleteProduct(parseInt(String(req.params.id)));
      res.json({ message: "Deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/products/import", authMiddleware, roleMiddleware("admin", "planning"), upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const workbook = XLSX.read(req.file.buffer);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (rows.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }

      const headerMap: Record<string, string> = {
        "itemcode": "itemCode", "item code": "itemCode", "item_code": "itemCode",
        "رمز الصنف": "itemCode", "رمز": "itemCode", "code": "itemCode", "sku": "itemCode",
        "description": "description", "desc": "description", "الوصف": "description", "وصف": "description",
        "brand": "brand", "العلامة التجارية": "brand", "العلامة": "brand", "ماركة": "brand",
        "department": "department", "dept": "department", "المصلحة": "department", "القسم": "department",
        "sellingprice": "sellingPrice", "selling price": "sellingPrice", "selling_price": "sellingPrice",
        "سعر البيع": "sellingPrice", "سعر بيع": "sellingPrice", "price": "sellingPrice",
        "costprice": "costPrice", "cost price": "costPrice", "cost_price": "costPrice",
        "سعر التكلفة": "costPrice", "تكلفة": "costPrice", "cost": "costPrice",
        "category": "category", "التصنيف": "category", "فئة": "category",
        "productcategory": "productCategory", "product category": "productCategory", "product_category": "productCategory",
        "نوع المنتج": "productCategory", "نوع منتج": "productCategory",
        "salesmethod": "salesMethod", "sales method": "salesMethod", "sales_method": "salesMethod",
        "طريقة البيع": "salesMethod", "طريقة بيع": "salesMethod",
        "availablequantity": "availableQuantity", "available quantity": "availableQuantity",
        "available_quantity": "availableQuantity", "quantity": "availableQuantity", "qty": "availableQuantity",
        "الكمية المتاحة": "availableQuantity", "الكمية": "availableQuantity", "كمية": "availableQuantity",
      };

      const firstRow = rows[0];
      const colMapping: Record<string, string> = {};
      for (const key of Object.keys(firstRow)) {
        const normalized = key.trim().toLowerCase();
        if (headerMap[normalized]) {
          colMapping[key] = headerMap[normalized];
        }
      }

      if (!Object.values(colMapping).includes("itemCode")) {
        return res.status(400).json({ message: "Missing required column: Item Code (itemCode / رمز الصنف)" });
      }

      const allProductCategories = await storage.getProductCategories();
      const categoryNameToId: Record<string, number> = {};
      for (const cat of allProductCategories) {
        categoryNameToId[cat.name.trim().toLowerCase()] = cat.id;
      }

      let skipped = 0;
      const errors: string[] = [];
      const validItems: any[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const mapped: any = {};
        for (const [excelCol, dbCol] of Object.entries(colMapping)) {
          mapped[dbCol] = String(row[excelCol] ?? "").trim();
        }

        if (!mapped.itemCode) {
          skipped++;
          continue;
        }

        if (!mapped.description) {
          mapped.description = "";
        }

        let productCategoryId: number | null = null;
        if (mapped.productCategory) {
          const catId = categoryNameToId[mapped.productCategory.trim().toLowerCase()];
          if (catId) {
            productCategoryId = catId;
          }
        }

        validItems.push({
          itemCode: mapped.itemCode,
          description: mapped.description,
          brand: mapped.brand || "",
          department: mapped.department || "",
          sellingPrice: (mapped.sellingPrice || "0").replace(/,/g, ""),
          costPrice: (mapped.costPrice || "0").replace(/,/g, ""),
          category: mapped.category || "",
          salesMethod: mapped.salesMethod || "",
          availableQuantity: mapped.availableQuantity ? parseInt(mapped.availableQuantity) : 0,
          productCategoryId,
        });
      }

      let created = 0;
      let updated = 0;
      const batchSize = 1000;
      for (let i = 0; i < validItems.length; i += batchSize) {
        const batch = validItems.slice(i, i + batchSize);
        try {
          const result = await storage.bulkUpsertProducts(batch);
          created += result.created;
          updated += result.updated;
        } catch (err: any) {
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${err.message}`);
          skipped += batch.length;
        }
      }

      res.json({ created, updated, imported: created + updated, skipped, total: rows.length, errors: errors.slice(0, 10) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Sales reps list (for dropdown in new request form)
  app.get("/api/admin/sales-reps", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const allUsers = await storage.getUsers();
      let salesReps = allUsers.filter(u => u.role === "sales_rep");

      const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;
      if (departmentId) {
        const deptBranchIds = await storage.getDepartmentBranches(departmentId);
        if (user.role === "branch_manager") {
          const userBrIds = await storage.getUserBranchIds(user.id, user.branchId);
          const intersection = deptBranchIds.filter(id => userBrIds.includes(id));
          salesReps = salesReps.filter(u => u.branchId && intersection.includes(u.branchId));
        } else if (user.role === "sales_rep") {
          const myBranches = user.branchId ? [user.branchId] : [];
          const intersection = deptBranchIds.filter(id => myBranches.includes(id));
          salesReps = salesReps.filter(u => u.branchId && intersection.includes(u.branchId));
        } else {
          salesReps = salesReps.filter(u => u.branchId && deptBranchIds.includes(u.branchId));
        }
      } else if (user.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(user.id, user.branchId);
        salesReps = salesReps.filter(u => u.branchId && branchIds.includes(u.branchId));
      } else if (user.role === "sales_rep") {
        if (user.branchId) {
          salesReps = salesReps.filter(u => u.branchId === user.branchId);
        }
      }

      res.json(salesReps.map(u => ({ id: u.id, name: u.name, email: u.email, branchId: u.branchId })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Users
  app.get("/api/users", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user || user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
      const usersList = await storage.getUsers();
      const usersWithBranches = await Promise.all(usersList.map(async u => {
        const { password: _, ...safeUser } = u;
        const branchIds = await storage.getUserBranchIds(u.id, u.branchId);
        return { ...safeUser, branchIds };
      }));
      res.json(usersWithBranches);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/users", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user || user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data" });
      
      const userData = { ...parsed.data };
      userData.password = await bcrypt.hash(userData.password, 10);
      
      const newUser = await storage.createUser(userData);
      if (req.body.branchIds && Array.isArray(req.body.branchIds)) {
        await storage.setUserBranches(newUser.id, req.body.branchIds.map(Number));
      }
      const { password: _, ...safeUser } = newUser;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/users/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user || user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
      const id = parseInt(String(req.params.id));
      
      const updateData = { ...req.body };
      if (updateData.password) {
        updateData.password = await bcrypt.hash(updateData.password, 10);
      }
      
      const updatedUser = await storage.updateUser(id, updateData);
      if (req.body.branchIds && Array.isArray(req.body.branchIds)) {
        await storage.setUserBranches(id, req.body.branchIds.map(Number));
      }
      const { password: _, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/users/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user || user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
      const id = parseInt(String(req.params.id));
      await storage.deleteUser(id);
      res.json({ message: "User deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/branches", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const branches = await storage.getBranches();
      res.json(branches);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/branches", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Branch name is required" });
      }
      const branch = await storage.createBranch(name.trim());
      res.json(branch);
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        return res.status(400).json({ message: "Branch already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/branches/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteBranch(parseInt(String(req.params.id)));
      res.json({ message: "Branch deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/requests", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const branchIds = user.role === "branch_manager" ? await storage.getUserBranchIds(user.id, user.branchId) : [];
      const result = await storage.getRequests(user.id, user.role, user.branchId, branchIds, user.productCategoryId);
      if (user.role === "sales_rep" || user.role === "branch_manager") {
        const sanitized = result.map((r: any) => ({
          ...r,
          items: r.items.map((item: any) => {
            const { costPrice, ...rest } = item;
            return rest;
          }),
        }));
        return res.json(sanitized);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/requests/export/excel", authMiddleware, roleMiddleware("planning", "admin", "sector_head", "category_manager", "sales_rep", "branch_manager"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo, requestId, requestIds, format } = req.query;
      const exportingUser = (req as any).user;
      const isSalesRep = exportingUser?.role === "sales_rep";
      const isBranchManager = exportingUser?.role === "branch_manager";
      const isSimpleFormat = format === "simple";

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allUsersData = await storage.getUsers();
      const allWarehouses = await db.select().from(adminWarehouses);
      const warehouseLocationMap: Record<string, string> = {};
      for (const wh of allWarehouses) {
        warehouseLocationMap[wh.name] = wh.location || "";
      }
      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) {
        if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = [];
        itemsByReqId[item.requestId].push(item);
      }

      let filteredReqs = allReqs.map(r => ({
        ...r,
        items: itemsByReqId[r.id] || [],
        creator: allUsersData.find((u: any) => u.id === r.createdBy),
        salesRep: allUsersData.find((u: any) => u.id === r.salesRepId),
      }));

      if (isSalesRep) {
        filteredReqs = filteredReqs.filter(r => r.createdBy === exportingUser.id || r.salesRepId === exportingUser.id);
      }

      if (isBranchManager) {
        const bmBranchIds = await storage.getUserBranchIds(exportingUser.id, exportingUser.branchId);
        const branchIdSet = new Set(bmBranchIds);
        filteredReqs = filteredReqs.filter(r => branchIdSet.has(r.branchId));
      }

      if (requestIds) {
        const ids = String(requestIds).split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (ids.length > 0) {
          const idSet = new Set(ids);
          filteredReqs = filteredReqs.filter(r => idSet.has(r.id));
        }
      } else if (requestId) {
        const reqIdNum = parseInt(String(requestId));
        if (isNaN(reqIdNum)) {
          return res.status(400).json({ message: "Invalid request ID" });
        }
        filteredReqs = filteredReqs.filter(r => r.id === reqIdNum);
      }
      if (dateFrom) {
        filteredReqs = filteredReqs.filter(r => r.requestDate >= String(dateFrom));
      }
      if (dateTo) {
        filteredReqs = filteredReqs.filter(r => r.requestDate <= String(dateTo));
      }

      filteredReqs.sort((a, b) => b.requestDate.localeCompare(a.requestDate));

      const statusLabelsAr: Record<string, string> = {
        submitted: "مُقدَّم",
        branch_approved: "معتمد من الفرع",
        category_approved: "معتمد من مدير الصنف",
        final_approved: "معتمد نهائياً",
        rejected: "مرفوض",
        expired: "منتهي",
      };

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Requests");

      let headerRow;
      if (isSimpleFormat) {
        headerRow = sheet.addRow([
          "رقم الطلب",
          "تاريخ الطلب",
          "تاريخ الانتهاء",
          "مدة الحجز",
          "رمز الصنف",
          "وصف الصنف",
          "العلامة التجارية",
          "الكمية المطلوبة",
          "الكمية المصروفة",
          "المتبقي",
          "القسم",
          "مندوب المبيعات",
          "اسم العميل",
          "المشروع",
          "رقم الحساب",
          "امر الشراء",
        ]);
      } else {
        headerRow = sheet.addRow([
          "رقم الطلب",
          "تاريخ الطلب",
          "الحالة",
          "القسم",
          "اسم العميل",
          "المشروع",
          "مندوب المبيعات",
          "مُنشئ الطلب",
          "مدة الحجز (أيام)",
          "تاريخ الانتهاء",
          "الدفعة المقدمة",
          "رقم حجز ساب",
          "اجمالي قيمة الحجز بيع",
          ...(!isSalesRep ? ["اجمالي قيمة الحجز تكلفة"] : []),
          "ملاحظات",
          "رمز الصنف",
          "وصف الصنف",
          "العلامة التجارية",
          "الكمية المطلوبة",
          "الكمية المصروفة",
          "المتبقي",
          "سعر البيع",
          ...(!isSalesRep ? ["سعر التكلفة"] : []),
          "المستودع",
          "موقع المستودع",
        ]);
      }

      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2E4057" },
      };
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

      for (const req of filteredReqs) {
        const totalSellingValue = req.items.reduce((sum, item) => {
          const price = item.sellingPrice ? Number(item.sellingPrice) : 0;
          return sum + (price * item.quantityRequested);
        }, 0);
        const totalCostValue = req.items.reduce((sum, item) => {
          const cost = item.costPrice ? Number(item.costPrice) : 0;
          return sum + (cost * item.quantityRequested);
        }, 0);

        if (isSimpleFormat) {
          if (req.items.length === 0) {
            sheet.addRow([
              req.requestNumber,
              req.requestDate,
              req.reservationEndDate || "",
              req.reservationDuration || "",
              "",
              "",
              "",
              "",
              "",
              "",
              req.department,
              req.salesRep?.name || "",
              req.customerName,
              req.projectName,
              req.customerAccountNumber || "",
              req.purchaseOrderFile ? "نعم" : "لا",
            ]);
          } else {
            for (const item of req.items) {
              const remaining = item.quantityRequested - (item.quantityReleased || 0);
              sheet.addRow([
                req.requestNumber,
                req.requestDate,
                req.reservationEndDate || "",
                req.reservationDuration || "",
                item.itemCode,
                item.itemDescription,
                item.brand,
                item.quantityRequested,
                item.quantityReleased || 0,
                remaining,
                req.department,
                req.salesRep?.name || "",
                req.customerName,
                req.projectName,
                req.customerAccountNumber || "",
                req.purchaseOrderFile ? "نعم" : "لا",
              ]);
            }
          }
          continue;
        }

        if (req.items.length === 0) {
          sheet.addRow([
            req.requestNumber,
            req.requestDate,
            statusLabelsAr[req.status] || req.status,
            req.department,
            req.customerName,
            req.projectName,
            req.salesRep?.name || "",
            req.creator?.name || "",
            req.reservationDuration || "",
            req.reservationEndDate || "",
            req.advancePayment ? Number(req.advancePayment) : "",
            req.sapReservationNumber || "",
            totalSellingValue,
            ...(!isSalesRep ? [totalCostValue] : []),
            req.notes || "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            ...(!isSalesRep ? [""] : []),
            "",
            "",
          ]);
          continue;
        }

        for (const item of req.items) {
          const remaining = item.quantityRequested - item.quantityReleased;
          sheet.addRow([
            req.requestNumber,
            req.requestDate,
            statusLabelsAr[req.status] || req.status,
            req.department,
            req.customerName,
            req.projectName,
            req.salesRep?.name || "",
            req.creator?.name || "",
            req.reservationDuration || "",
            req.reservationEndDate || "",
            req.advancePayment ? Number(req.advancePayment) : "",
            req.sapReservationNumber || "",
            totalSellingValue,
            ...(!isSalesRep ? [totalCostValue] : []),
            req.notes || "",
            item.itemCode,
            item.itemDescription,
            item.brand,
            item.quantityRequested,
            item.quantityReleased,
            remaining,
            item.sellingPrice ? Number(item.sellingPrice) : "",
            ...(!isSalesRep ? [item.costPrice ? Number(item.costPrice) : ""] : []),
            item.warehouse,
            warehouseLocationMap[item.warehouse] || "",
          ]);
        }
      }

      sheet.columns.forEach(col => { col.width = 16; });

      const numFmt = '#,##0';
      const numFmt2 = '#,##0.00';
      sheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        row.eachCell((cell) => {
          if (typeof cell.value === 'number' && cell.value !== 0) {
            cell.numFmt = Number.isInteger(cell.value) ? numFmt : numFmt2;
          }
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=Requests_Export_${new Date().toISOString().split("T")[0]}.xlsx`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("[Requests Excel Export Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/requests/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const id = parseInt(String(req.params.id));
      const result = await storage.getRequestById(id);
      if (!result) return res.status(404).json({ message: "Request not found" });

      if (user.role === "sales_rep" && result.createdBy !== user.id && result.salesRepId !== user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (user.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(user.id, user.branchId);
        if (!branchIds.includes(result.branchId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      if (user.role === "sales_rep" || user.role === "branch_manager") {
        const sanitized = {
          ...result,
          items: result.items.map((item: any) => {
            const { costPrice, ...rest } = item;
            return rest;
          }),
        };
        return res.json(sanitized);
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/upload/excel", authMiddleware, upload.single("excel"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No Excel file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

      if (rawData.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }

      const headerMap: Record<string, string> = {};
      const firstRow = rawData[0];
      const keys = Object.keys(firstRow);

      for (const key of keys) {
        const lower = key.toLowerCase().trim();
        // Item Code mappings
        if (
          (lower.includes("item") && lower.includes("code")) || 
          lower === "code" || 
          lower.includes("رمز") || 
          lower.includes("كود")
        ) {
          headerMap[key] = "itemCode";
        }
        // Description mappings
        else if (
          lower.includes("description") || 
          lower.includes("desc") || 
          lower.includes("وصف") || 
          lower === "item" || 
          lower === "صنف"
        ) {
          headerMap[key] = "itemDescription";
        }
        // Brand mappings
        else if (
          lower.includes("brand") || 
          lower.includes("ماركة") || 
          lower.includes("علامة")
        ) {
          headerMap[key] = "brand";
        }
        // Quantity mappings
        else if (
          lower.includes("quantity") || 
          lower.includes("qty") || 
          lower.includes("كمية") || 
          lower === "عدد"
        ) {
          headerMap[key] = "quantityRequested";
        }
        // Duration mappings
        else if (
          lower.includes("duration") || 
          lower.includes("مدة") || 
          lower.includes("ايام") || 
          lower.includes("أيام") ||
          lower.includes("الحجز") ||
          lower.includes("فترة") ||
          lower.includes("الوقت")
        ) {
          headerMap[key] = "reservationDuration";
        }
        // Warehouse mappings
        else if (
          lower.includes("warehouse") || 
          lower.includes("مستودع") || 
          lower.includes("مخزن")
        ) {
          headerMap[key] = "warehouse";
        }
      }

      const requiredFields = ["itemCode", "quantityRequested", "warehouse"];
      const mappedFields = Object.values(headerMap);
      const missingFields = requiredFields.filter(f => !mappedFields.includes(f));

      if (missingFields.length > 0) {
        return res.status(400).json({
          message: `Missing required columns: ${missingFields.join(", ")}. Expected columns: Item Code, Quantity, Warehouse`,
          missingFields,
        });
      }

      const items = rawData.map((row, index) => {
        const mapped: Record<string, any> = {};
        for (const [originalKey, fieldName] of Object.entries(headerMap)) {
          mapped[fieldName] = row[originalKey];
        }
        return {
          rowIndex: index + 1,
          itemCode: String(mapped.itemCode || "").trim(),
          quantityRequested: parseInt(String(mapped.quantityRequested || "0"), 10),
          warehouse: String(mapped.warehouse || "").trim(),
        };
      });

      const errors: string[] = [];
      items.forEach((item, i) => {
        if (!item.itemCode) errors.push(`Row ${i + 1}: Missing item code`);
        if (!item.quantityRequested || item.quantityRequested <= 0) errors.push(`Row ${i + 1}: Invalid quantity`);
        if (!item.warehouse) errors.push(`Row ${i + 1}: Missing warehouse`);
      });

      if (errors.length > 0) {
        return res.status(400).json({ message: "Validation errors in Excel data", errors });
      }

      const notFoundCodes: string[] = [];
      const enrichedItems = [];
      for (const item of items) {
        const product = await storage.getProductByCode(item.itemCode);
        if (!product) {
          notFoundCodes.push(item.itemCode);
        } else {
          enrichedItems.push({
            ...item,
            itemDescription: product.description,
            brand: product.brand,
            sellingPrice: product.sellingPrice,
            costPrice: product.costPrice,
            lookupStatus: "found",
          });
        }
      }

      if (enrichedItems.length === 0 && notFoundCodes.length > 0) {
        return res.status(400).json({
          message: `الأصناف التالية غير موجودة: ${notFoundCodes.join("، ")} — يرجى التواصل مع مسؤول قسم التخطيط والخزين`,
          notFoundCodes,
        });
      }

      res.json({ items: enrichedItems, notFoundCodes });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/upload/purchase-order", authMiddleware, upload.single("purchaseOrder"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (BUCKET_NAME) {
        const cloudPath = await uploadFileToObjectStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
        return res.json({ filePath: cloudPath });
      }
      // Fallback: save locally if no Object Storage configured
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(req.file.originalname);
      const filename = uniqueSuffix + ext;
      fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
      res.json({ filePath: filename });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/upload/account-statement", authMiddleware, upload.single("accountStatement"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (BUCKET_NAME) {
        const cloudPath = await uploadFileToObjectStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
        return res.json({ filePath: cloudPath });
      }
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(req.file.originalname);
      const filename = uniqueSuffix + ext;
      fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
      res.json({ filePath: filename });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/requests", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const parsed = createRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request data", errors: parsed.error.issues });
      }

      if (parsed.data.salesChannel && parsed.data.salesChannel !== "strategic_reservation") {
        return res.status(400).json({ message: "Invalid sales channel" });
      }
      if (parsed.data.salesChannel === "strategic_reservation" && user.role !== "planning" && user.role !== "admin") {
        return res.status(403).json({ message: "Only Planning can create strategic reservations" });
      }
      const isStrategic = parsed.data.salesChannel === "strategic_reservation" && (user.role === "planning" || user.role === "admin");
      const durationNum = parseInt(parsed.data.reservationDuration, 10);
      if (!isStrategic && durationNum > 15) {
        const hasPaymentPath = (parsed.data.advancePayment || parsed.data.advancePayment === 0) && parsed.data.accountStatementFile;
        const hasPOPath = !!parsed.data.purchaseOrderFile;
        if (!hasPaymentPath && !hasPOPath) {
          return res.status(400).json({ message: "For reservations longer than 15 days: either (Advance Payment + Account Statement) or (Purchase Order) is required" });
        }
      }

      const today = new Date().toISOString().split("T")[0];
      const branchId = user.branchId || 1;
      const initialStatus = isStrategic ? "category_approved" : "submitted";
      const request = await storage.createRequest({
        createdBy: user.id,
        salesRepId: isStrategic ? user.id : parsed.data.salesRepId,
        branchId,
        notes: parsed.data.notes,
        requestDate: today,
        department: parsed.data.department,
        customerName: parsed.data.customerName,
        customerAccountNumber: parsed.data.customerAccountNumber,
        projectName: parsed.data.projectName,
        reservationDuration: parsed.data.reservationDuration,
        reservationEndDate: parsed.data.reservationEndDate,
        advancePayment: parsed.data.advancePayment,
        purchaseOrderFile: parsed.data.purchaseOrderFile,
        accountStatementFile: parsed.data.accountStatementFile,
        productCategoryId: parsed.data.productCategoryId,
        salesChannel: parsed.data.salesChannel || null,
      });

      if (isStrategic) {
        await storage.updateRequestStatus(request.id, "category_approved");
      }

      for (const item of parsed.data.items) {
        await storage.createRequestItem({
          requestId: request.id,
          itemCode: item.itemCode,
          itemDescription: item.itemDescription,
          brand: item.brand,
          quantityRequested: item.quantityRequested,
          warehouse: item.warehouse,
          sellingPrice: (item as any).sellingPrice || null,
          costPrice: (item as any).costPrice || null,
        });
      }

      await storage.createAuditLog({
        userId: user.id,
        action: isStrategic ? "created strategic request" : "created request",
        entity: "request",
        entityId: request.id,
        newData: { projectName: parsed.data.projectName, department: parsed.data.department, itemCount: parsed.data.items.length, salesChannel: parsed.data.salesChannel },
      });

      const allUsers = await storage.getUsers();

      if (isStrategic) {
        const sectorHeads = allUsers.filter(u => u.role === "sector_head");
        const admins = allUsers.filter(u => u.role === "admin");
        const notifyUsers = [...sectorHeads, ...admins];
        for (const nu of notifyUsers) {
          if (nu.id !== user.id) {
            await storage.createNotification(
              nu.id,
              "Strategic Reservation",
              `${user.name} created strategic request #${request.requestNumber} - needs Sector Head approval`,
              `/requests/${request.id}`
            );
          }
        }
      } else {
        const branchManagerIds = await getBranchManagerUserIds(branchId, allUsers);
        const branchManagers = allUsers.filter(u => branchManagerIds.includes(u.id));
        const admins = allUsers.filter(u => u.role === "admin");
        const notifyUsers = [...branchManagers, ...admins];
        for (const nu of notifyUsers) {
          if (nu.id !== user.id) {
            await storage.createNotification(
              nu.id,
              "New Request",
              `${user.name} submitted request #${request.requestNumber}`,
              `/requests/${request.id}`
            );
          }
        }
      }

      const emailRecipients = collectRecipients(allUsers, {
        createdById: user.id,
        salesRepId: isStrategic ? user.id : parsed.data.salesRepId,
        branchId,
        productCategoryId: parsed.data.productCategoryId,
        actorId: user.id,
        notifyRoles: isStrategic ? ["sector_head"] : ["branch_manager"],
      });
      sendOrderEmail({
        eventType: "request_created",
        recipients: emailRecipients,
        requestNumber: request.requestNumber,
        requestId: request.id,
        projectName: parsed.data.projectName,
        actorName: user.name,
        actorRole: user.role,
        notes: parsed.data.notes,
      }).catch(err => console.error("[Email] Background send error:", err));

      res.json(request);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/requests/:id/approve", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const requestId = parseInt(String(req.params.id));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const { action, notes } = req.body;
      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "Invalid action" });
      }

      const allApprovalsForRequest = await storage.getApprovalsByRequest(requestId);
      const duration = parseInt(request.reservationDuration || "0");

      const isStrategicReq = request.salesChannel === "strategic_reservation";

      // Sort request-type approvals chronologically to detect post-reset state
      const requestApprovalsSorted = allApprovalsForRequest
        .filter((a: any) => (a.type ?? "request") === "request")
        .slice()
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const canApprove = (role: string, status: string) => {
        if (status === "expired" || status === "lost_opportunity" || status === "confirmed_lost_opportunity" || status === "closed") return false;
        if (role === "admin") return status !== "rejected" && status !== "final_approved";
        if (role === "branch_manager") return status === "submitted";
        if (role === "category_manager") return status === "branch_approved";
        if (role === "sector_head") {
          if (status !== "category_approved") return false;
          if (!isStrategicReq && duration <= 90) return false;
          // Allow re-approval if there has been a reject AFTER the latest sector_head approval (rollback case)
          let lastSectorApproveIdx = -1;
          let lastRejectIdx = -1;
          requestApprovalsSorted.forEach((a: any, i: number) => {
            if (a.role === "sector_head" && a.action === "approve") lastSectorApproveIdx = i;
            if (a.action === "reject") lastRejectIdx = i;
          });
          if (lastSectorApproveIdx === -1) return true;
          return lastRejectIdx > lastSectorApproveIdx;
        }
        if (role === "planning") {
          if (isStrategicReq) return false;
          return status === "category_approved";
        }
        return false;
      };

      if (!canApprove(user.role, request.status)) {
        return res.status(403).json({ message: "You cannot approve/reject this request at this stage" });
      }

      // Additional check for planning: if duration > 90, sector head (or admin) must have approved AFTER the most recent reject
      if (user.role === "planning" && duration > 90) {
        let lastSectorApproveIdx = -1;
        let lastRejectIdx = -1;
        requestApprovalsSorted.forEach((a: any, i: number) => {
          if ((a.role === "sector_head" || a.role === "admin") && a.action === "approve") lastSectorApproveIdx = i;
          if (a.action === "reject") lastRejectIdx = i;
        });
        const sectorApproved = lastSectorApproveIdx !== -1 && lastSectorApproveIdx > lastRejectIdx;
        if (!sectorApproved) {
          return res.status(403).json({ message: "Sector Head approval is required before Planning for reservations > 90 days" });
        }
      }

      if (user.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(user.id, user.branchId);
        if (!branchIds.includes(request.branchId)) {
          return res.status(403).json({ message: "You can only approve requests from your branch" });
        }
      }

      if (user.role === "category_manager" && user.productCategoryId) {
        if (request.productCategoryId !== user.productCategoryId) {
          return res.status(403).json({ message: "You can only approve requests matching your product category" });
        }
      }

      const oldStatus = request.status;

      if (action === "reject") {
        // Determine rollback target based on rejector's stage
        let revertedStatus: string;
        let returnedToRole: string | null = null;
        if (user.role === "branch_manager" || (user.role === "admin" && oldStatus === "submitted")) {
          // First-stage reject → terminal "rejected"; sales rep edits & resubmits
          revertedStatus = "rejected";
          returnedToRole = "sales_rep";
        } else if (user.role === "category_manager" || (user.role === "admin" && oldStatus === "branch_approved")) {
          revertedStatus = "submitted";
          returnedToRole = "branch_manager";
        } else if (user.role === "sector_head") {
          if (isStrategicReq) {
            // Strategic reservation has no prior approver → terminal reject
            revertedStatus = "rejected";
            returnedToRole = "planning";
          } else {
            revertedStatus = "branch_approved";
            returnedToRole = "category_manager";
          }
        } else if (user.role === "planning" || (user.role === "admin" && oldStatus === "category_approved")) {
          if (isStrategicReq) {
            // Strategic reservation: only sector_head approves; admin rejecting at category_approved → terminal
            revertedStatus = "rejected";
            returnedToRole = "planning";
          } else if (duration > 90) {
            // Sector head approved before planning → revert to sector head re-review
            revertedStatus = "category_approved";
            returnedToRole = "sector_head";
          } else {
            revertedStatus = "branch_approved";
            returnedToRole = "category_manager";
          }
        } else {
          revertedStatus = "rejected";
          returnedToRole = "sales_rep";
        }

        await storage.updateRequestStatus(requestId, revertedStatus);
        const rejectNotePrefix = revertedStatus === "rejected"
          ? `Rejected by ${user.role}.`
          : `Rejected by ${user.role}, returned to ${returnedToRole} for re-review.`;
        await storage.createApproval({
          requestId,
          role: user.role,
          action: "reject",
          notes: `${rejectNotePrefix}${notes ? ` Reason: ${notes}` : ""}`,
          userId: user.id,
        });

        const allUsersForNotif = await storage.getUsers();

        // Always notify creator + sales rep
        await storage.createNotification(
          request.createdBy,
          revertedStatus === "rejected" ? "Request Rejected" : "Request Returned",
          revertedStatus === "rejected"
            ? `Your request #${request.requestNumber} was rejected by ${user.name}. Please review and resubmit.`
            : `Request #${request.requestNumber} was rejected by ${user.name} and returned to ${returnedToRole} for re-review.`,
          `/requests/${requestId}`
        );

        if (request.salesRepId && request.salesRepId !== request.createdBy) {
          await storage.createNotification(
            request.salesRepId,
            revertedStatus === "rejected" ? "Request Rejected" : "Request Returned",
            revertedStatus === "rejected"
              ? `Request #${request.requestNumber} was rejected by ${user.name}. The sales rep needs to review and resubmit.`
              : `Request #${request.requestNumber} was rejected by ${user.name}, returned to ${returnedToRole} for re-review.`,
            `/requests/${requestId}`
          );
        }

        // Notify the previous approver(s) so they can act
        if (revertedStatus !== "rejected" && returnedToRole) {
          let priorApprovers: any[] = [];
          if (returnedToRole === "branch_manager") {
            priorApprovers = allUsersForNotif.filter(u => u.role === "branch_manager");
            // Filter to managers of this branch
            const filtered: any[] = [];
            for (const bm of priorApprovers) {
              const ids = await storage.getUserBranchIds(bm.id, bm.branchId);
              if (ids.includes(request.branchId)) filtered.push(bm);
            }
            priorApprovers = filtered;
          } else if (returnedToRole === "category_manager") {
            priorApprovers = allUsersForNotif.filter(u => u.role === "category_manager" && u.productCategoryId === request.productCategoryId);
          } else if (returnedToRole === "sector_head") {
            priorApprovers = allUsersForNotif.filter(u => u.role === "sector_head");
          }
          for (const a of priorApprovers) {
            if (a.id === user.id) continue;
            await storage.createNotification(
              a.id,
              "Request Returned for Re-Review",
              `Request #${request.requestNumber} was rejected by ${user.name} and needs your re-review.`,
              `/requests/${requestId}`
            );
          }
        }
      } else {
        let newStatus: string;
        if (user.role === "branch_manager" || (user.role === "admin" && oldStatus === "submitted")) {
          newStatus = "branch_approved";
        } else if (user.role === "category_manager" || (user.role === "admin" && oldStatus === "branch_approved")) {
          newStatus = "category_approved";
        } else if (user.role === "sector_head" || (user.role === "admin" && oldStatus === "category_approved" && duration > 90)) {
          if (isStrategicReq) {
            newStatus = "final_approved";
          } else {
            newStatus = "category_approved";
          }
        } else {
          newStatus = "final_approved";
        }
        await storage.updateRequestStatus(requestId, newStatus);
        await storage.createApproval({ requestId, role: user.role, action: "approve", notes, userId: user.id });

        await storage.createNotification(
          request.createdBy,
          newStatus === "final_approved" ? "Request Final Approved" : "Request Approved",
          `Request #${request.requestNumber} ${newStatus === "final_approved" ? "received final approval" : "was approved"} by ${user.name}`,
          `/requests/${requestId}`
        );

        // Always notify Sales Rep of status changes
        if (request.salesRepId && request.salesRepId !== request.createdBy && request.salesRepId !== user.id) {
          await storage.createNotification(
            request.salesRepId,
            newStatus === "final_approved" ? "Request Final Approved" : "Request Approved",
            `Request #${request.requestNumber} status updated to: ${newStatus}`,
            `/requests/${requestId}`
          );
        }

        if (newStatus === "branch_approved") {
          const allUsers = await storage.getUsers();
          const catManagers = allUsers.filter(u => u.role === "category_manager" && u.productCategoryId && u.productCategoryId === request.productCategoryId);
          for (const cm of catManagers) {
            await storage.createNotification(cm.id, "Pending Approval", `Request #${request.requestNumber} needs your approval`, `/requests/${requestId}`);
          }
        } else if (newStatus === "category_approved") {
          const allUsers = await storage.getUsers();
          const approverIsSectorHead = user.role === "sector_head" || (user.role === "admin" && oldStatus === "category_approved" && duration > 90);
          if (approverIsSectorHead) {
            // Sector head just approved → notify Planning
            const planners = allUsers.filter(u => u.role === "planning");
            for (const p of planners) {
              await storage.createNotification(p.id, "Pending Final Approval", `Request #${request.requestNumber} (Duration: ${duration} days) - sector head approved, needs final planning approval`, `/requests/${requestId}`);
            }
          } else if (duration > 90) {
            // Category manager just approved, duration > 90 → must go to Sector Head first
            const sectorHeads = allUsers.filter(u => u.role === "sector_head");
            for (const sh of sectorHeads) {
              await storage.createNotification(sh.id, "Pending Approval", `Request #${request.requestNumber} (Duration: ${duration} days) needs sector head approval`, `/requests/${requestId}`);
            }
          } else {
            // Category manager approved, duration <= 90 → go to Planning
            const planners = allUsers.filter(u => u.role === "planning");
            for (const p of planners) {
              await storage.createNotification(p.id, "Pending Final Approval", `Request #${request.requestNumber} needs final approval`, `/requests/${requestId}`);
            }
          }
        }
      }

      const allUsersForEmail = await storage.getUsers();
      if (action === "reject") {
        const updatedReq = await storage.getRequestById(requestId);
        const finalRevertedStatus = updatedReq?.status || oldStatus;
        await storage.createAuditLog({
          userId: user.id,
          action: finalRevertedStatus === "rejected" ? "rejected request" : "rejected and returned request",
          entity: "request",
          entityId: requestId,
          oldData: { status: oldStatus },
          newData: { status: finalRevertedStatus, action, notes, rejectedByRole: user.role },
        });

        // Derive role(s) to notify by email based on the rolled-back status
        const notifyRolesForReject: string[] = [];
        if (finalRevertedStatus === "submitted") notifyRolesForReject.push("branch_manager");
        else if (finalRevertedStatus === "branch_approved") notifyRolesForReject.push("category_manager");
        else if (finalRevertedStatus === "category_approved" && !isStrategicReq && duration > 90) notifyRolesForReject.push("sector_head");

        const emailRecipients = collectRecipients(allUsersForEmail, {
          createdById: request.createdBy,
          salesRepId: request.salesRepId,
          branchId: request.branchId,
          productCategoryId: request.productCategoryId,
          actorId: user.id,
          notifyRoles: notifyRolesForReject,
        });
        sendOrderEmail({
          eventType: "request_rejected",
          recipients: emailRecipients,
          requestNumber: request.requestNumber,
          requestId,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes,
          newStatus: finalRevertedStatus,
        }).catch(err => console.error("[Email] Background send error:", err));
      } else {
        await storage.createAuditLog({
          userId: user.id,
          action: "approved request",
          entity: "request",
          entityId: requestId,
          oldData: { status: oldStatus },
          newData: { action, notes },
        });
        const newStatusForEmail = user.role === "branch_manager" || (user.role === "admin" && oldStatus === "submitted")
          ? "branch_approved"
          : user.role === "category_manager" || (user.role === "admin" && oldStatus === "branch_approved")
            ? "category_approved"
            : "final_approved";
        const nextRoles: string[] = [];
        if (newStatusForEmail === "branch_approved") nextRoles.push("category_manager");
        else if (newStatusForEmail === "category_approved") {
          const duration = parseInt(request.reservationDuration || "0");
          if (duration > 90) {
            nextRoles.push("sector_head");
          } else {
            nextRoles.push("planning");
          }
        }
        else if (newStatusForEmail === "final_approved") {
          nextRoles.push("category_manager", "planning");
        }
        const emailRecipients = collectRecipients(allUsersForEmail, {
          createdById: request.createdBy,
          salesRepId: request.salesRepId,
          branchId: request.branchId,
          productCategoryId: request.productCategoryId,
          actorId: user.id,
          notifyRoles: ["branch_manager", ...nextRoles],
        });
        sendOrderEmail({
          eventType: newStatusForEmail === "final_approved" ? "request_final_approved" : "request_approved",
          recipients: emailRecipients,
          requestNumber: request.requestNumber,
          requestId,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes,
          newStatus: newStatusForEmail,
        }).catch(err => console.error("[Email] Background send error:", err));
      }

      res.json({ message: "Action completed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/requests/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const requestId = parseInt(req.params.id as string);
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const canEdit = (role: string, status: string, isCreator: boolean) => {
        if (status === "expired" || status === "lost_opportunity" || status === "confirmed_lost_opportunity" || status === "closed") return false;
        if (role === "admin") return true;
        if (role === "sales_rep") return isCreator && (status === "rejected" || status === "submitted");
        if (role === "branch_manager") return status === "submitted";
        if (role === "category_manager") return status === "branch_approved";
        if (role === "planning") return status === "category_approved" || status === "final_approved";
        return false;
      };

      if (!canEdit(user.role, request.status, request.createdBy === user.id)) {
        return res.status(403).json({ message: "You cannot edit this request at this stage" });
      }

      if (user.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(user.id, user.branchId);
        if (!branchIds.includes(request.branchId)) {
          return res.status(403).json({ message: "You can only edit requests from your branch" });
        }
      }

      const { department, customerName, customerAccountNumber, projectName, requestDate, reservationDuration, reservationEndDate, advancePayment, notes, items, sapReservationNumber, salesRepId, purchaseOrderFile, accountStatementFile } = req.body;

      const oldData = {
        department: request.department,
        customerName: request.customerName,
        projectName: request.projectName,
        reservationDuration: request.reservationDuration,
        reservationEndDate: request.reservationEndDate,
        advancePayment: request.advancePayment,
        sapReservationNumber: request.sapReservationNumber,
        salesRepId: request.salesRepId,
        purchaseOrderFile: request.purchaseOrderFile,
        accountStatementFile: request.accountStatementFile,
        notes: request.notes,
        items: request.items.map((i: any) => ({
          itemCode: i.itemCode,
          itemDescription: i.itemDescription,
          brand: i.brand,
          quantityRequested: i.quantityRequested,
          warehouse: i.warehouse,
        })),
      };

      const updateData: any = {
        department,
        customerName,
        customerAccountNumber,
        projectName,
        reservationDuration,
        reservationEndDate,
        advancePayment: advancePayment ? Number(advancePayment) : undefined,
        notes,
      };
      if ((user.role === "planning" || user.role === "admin") && requestDate) {
        updateData.requestDate = requestDate;
        const requestDateChanged = requestDate !== request.requestDate;
        const durationChanged = reservationDuration && String(reservationDuration) !== String(request.reservationDuration);
        if (reservationDuration && (requestDateChanged || durationChanged)) {
          const d = new Date(requestDate);
          d.setDate(d.getDate() + parseInt(reservationDuration, 10));
          updateData.reservationEndDate = d.toISOString().split("T")[0];
        } else {
          updateData.reservationEndDate = request.reservationEndDate;
        }
      }
      if ((user.role === "planning" || user.role === "admin") && sapReservationNumber !== undefined) {
        updateData.sapReservationNumber = sapReservationNumber || null;
      }
      if (purchaseOrderFile !== undefined) updateData.purchaseOrderFile = purchaseOrderFile || null;
      if (accountStatementFile !== undefined) updateData.accountStatementFile = accountStatementFile || null;
      if ((user.role === "planning" || user.role === "admin") && salesRepId !== undefined) {
        updateData.salesRepId = salesRepId ? Number(salesRepId) : null;
      }

      const isStrategicEdit = (request as any).salesChannel === "strategic_reservation";
      const finalDuration = reservationDuration !== undefined ? parseInt(String(reservationDuration), 10) : parseInt(String(request.reservationDuration || "0"), 10);
      if (!isStrategicEdit && finalDuration > 15) {
        const finalAdvancePayment = advancePayment !== undefined ? Number(advancePayment) : Number(request.advancePayment || 0);
        const finalAccountStatement = accountStatementFile !== undefined ? (accountStatementFile || null) : (request.accountStatementFile || null);
        const finalPurchaseOrder = purchaseOrderFile !== undefined ? (purchaseOrderFile || null) : (request.purchaseOrderFile || null);
        const hasPaymentPath = !!finalAdvancePayment && !!finalAccountStatement;
        const hasPOPath = !!finalPurchaseOrder;
        if (!hasPaymentPath && !hasPOPath) {
          return res.status(400).json({ message: "للحجوزات الأطول من 15 يوماً: يجب إرفاق (الدفعة المقدمة + كشف الحساب) أو (أمر الشراء) / For reservations longer than 15 days: either (Advance Payment + Account Statement) or (Purchase Order) is required" });
        }
      }

      await storage.updateRequest(requestId, updateData);

      const itemChanges: { action: "added" | "removed" | "modified"; itemCode: string; description: string; oldQty?: number; newQty?: number; qty?: number }[] = [];

      if (items && Array.isArray(items) && items.length > 0) {
        const validItems = items.filter((item: any) => item.itemCode && Number(item.quantityRequested) > 0);
        if (validItems.length === 0) {
          return res.status(400).json({ message: "At least one valid item with code and quantity is required" });
        }

        const existingItems = request.items as any[];
        const existingByCode = new Map<string, any[]>();
        for (const ei of existingItems) {
          const arr = existingByCode.get(ei.itemCode) || [];
          arr.push(ei);
          existingByCode.set(ei.itemCode, arr);
        }

        const oldItemMap = new Map(oldData.items.map((i: any) => [i.itemCode, i]));
        const newItemCodes = new Set(validItems.map((i: any) => i.itemCode));

        const usedExistingIds = new Set<number>();
        const newItemCodesCount = new Map<string, number>();
        for (const item of validItems) {
          newItemCodesCount.set(item.itemCode, (newItemCodesCount.get(item.itemCode) || 0) + 1);
        }

        for (const oldItem of oldData.items) {
          if (!newItemCodes.has(oldItem.itemCode)) {
            itemChanges.push({ action: "removed", itemCode: oldItem.itemCode, description: oldItem.itemDescription, oldQty: oldItem.quantityRequested });
          }
        }

        const codeUsageIndex = new Map<string, number>();

        for (const item of validItems) {
          const newQty = Number(item.quantityRequested);
          const code = item.itemCode;
          const idx = codeUsageIndex.get(code) || 0;
          codeUsageIndex.set(code, idx + 1);
          const existingArr = existingByCode.get(code) || [];
          const matchingExisting = existingArr[idx];

          if (matchingExisting && !usedExistingIds.has(matchingExisting.id)) {
            usedExistingIds.add(matchingExisting.id);
            const oldQty = matchingExisting.quantityRequested;
            let quantityChangedFrom: number | null = null;
            if (oldQty !== newQty) {
              quantityChangedFrom = oldQty;
              itemChanges.push({ action: "modified", itemCode: code, description: item.itemDescription || matchingExisting.itemDescription, oldQty, newQty });
            }
            await db.update(requestItems).set({
              itemDescription: item.itemDescription || matchingExisting.itemDescription,
              brand: item.brand || matchingExisting.brand,
              quantityRequested: newQty,
              warehouse: item.warehouse || matchingExisting.warehouse,
              sellingPrice: item.sellingPrice || matchingExisting.sellingPrice,
              costPrice: item.costPrice || matchingExisting.costPrice,
              quantityChangedFrom,
              isNewItem: false,
            }).where(eq(requestItems.id, matchingExisting.id));
          } else {
            const oldItem = oldItemMap.get(code) as any;
            itemChanges.push({ action: "added", itemCode: code, description: item.itemDescription || "", qty: newQty });
            await storage.createRequestItem({
              requestId,
              itemCode: code,
              itemDescription: item.itemDescription || "",
              brand: item.brand || "",
              quantityRequested: newQty,
              warehouse: item.warehouse || "",
              sellingPrice: item.sellingPrice || null,
              costPrice: item.costPrice || null,
              quantityChangedFrom: null,
              isNewItem: true,
            });
          }
        }

        const idsToDelete = existingItems
          .filter(ei => !usedExistingIds.has(ei.id))
          .map(ei => ei.id);
        if (idsToDelete.length > 0) {
          for (const id of idsToDelete) {
            await db.delete(requestItems).where(eq(requestItems.id, id));
          }
        }
      }

      if (user.role === "sales_rep" && request.status === "rejected") {
        await storage.updateRequestStatus(requestId, "submitted");
      }

      const editAction = user.role === "sales_rep" && request.status === "rejected" ? "resubmitted" : "edit";

      const headerChangedFields: { fieldAr: string; fieldEn: string; oldValue: string; newValue: string }[] = [];
      if (department && department !== request.department) {
        headerChangedFields.push({ fieldAr: "القسم", fieldEn: "Department", oldValue: request.department, newValue: department });
      }
      if (customerName && customerName !== request.customerName) {
        headerChangedFields.push({ fieldAr: "العميل", fieldEn: "Customer", oldValue: request.customerName || "-", newValue: customerName });
      }
      if (projectName && projectName !== request.projectName) {
        headerChangedFields.push({ fieldAr: "المشروع", fieldEn: "Project", oldValue: request.projectName, newValue: projectName });
      }
      if (reservationDuration && String(reservationDuration) !== String(request.reservationDuration)) {
        headerChangedFields.push({ fieldAr: "مدة الحجز (أيام)", fieldEn: "Duration (days)", oldValue: request.reservationDuration || "-", newValue: String(reservationDuration) });
      }
      if (updateData.reservationEndDate && updateData.reservationEndDate !== request.reservationEndDate) {
        headerChangedFields.push({ fieldAr: "تاريخ الانتهاء", fieldEn: "End Date", oldValue: request.reservationEndDate || "-", newValue: updateData.reservationEndDate });
      }
      if (updateData.requestDate && updateData.requestDate !== request.requestDate) {
        headerChangedFields.push({ fieldAr: "تاريخ الطلب", fieldEn: "Request Date", oldValue: request.requestDate || "-", newValue: updateData.requestDate });
      }
      if (advancePayment !== undefined && Number(advancePayment) !== Number(request.advancePayment || 0)) {
        headerChangedFields.push({ fieldAr: "الدفعة المقدمة", fieldEn: "Advance Payment", oldValue: String(request.advancePayment || 0), newValue: String(advancePayment) });
      }
      if (updateData.sapReservationNumber !== undefined && updateData.sapReservationNumber !== request.sapReservationNumber) {
        headerChangedFields.push({ fieldAr: "رقم حجز SAP", fieldEn: "SAP Reservation #", oldValue: request.sapReservationNumber || "-", newValue: updateData.sapReservationNumber || "-" });
      }
      if (notes !== undefined && notes !== request.notes) {
        headerChangedFields.push({ fieldAr: "ملاحظات", fieldEn: "Notes", oldValue: request.notes || "-", newValue: notes || "-" });
      }

      const approvalNotesData = editAction === "resubmitted"
        ? (notes ? `Resubmitted after rejection: ${notes}` : "Resubmitted after rejection")
        : JSON.stringify({
            type: "edit",
            message: notes || "",
            diff: headerChangedFields,
            itemChanges,
          });

      await storage.createApproval({
        requestId,
        role: user.role,
        action: "edit",
        notes: approvalNotesData,
        userId: user.id,
      });

      await storage.createAuditLog({
        userId: user.id,
        action: editAction === "resubmitted" ? "resubmitted request after rejection" : "edited request",
        entity: "request",
        entityId: requestId,
        oldData: { ...oldData, status: request.status },
        newData: {
          department, projectName, reservationDuration, reservationEndDate, advancePayment, notes, items,
          ...(editAction === "resubmitted" ? { status: "submitted" } : {}),
        },
      });

      const allUsers = await storage.getUsers();
      const notifyTargets = new Set<number>();

      notifyTargets.add(request.createdBy);

      if (request.salesRepId) notifyTargets.add(request.salesRepId);

      const branchManagerIds = await getBranchManagerUserIds(request.branchId, allUsers);
      const branchManagers = allUsers.filter(u => branchManagerIds.includes(u.id));
      branchManagers.forEach(bm => notifyTargets.add(bm.id));

      if (["branch_approved", "category_approved"].includes(request.status)) {
        allUsers.filter(u => u.role === "category_manager" && u.productCategoryId && u.productCategoryId === request.productCategoryId).forEach(cm => notifyTargets.add(cm.id));
      }
      if (request.status === "category_approved") {
        allUsers.filter(u => u.role === "planning").forEach(p => notifyTargets.add(p.id));
      }

      allUsers.filter(u => u.role === "admin").forEach(a => notifyTargets.add(a.id));

      notifyTargets.delete(user.id);

      const notifTitle = editAction === "resubmitted" ? "Request Resubmitted" : "Request Edited";
      const notifMsg = editAction === "resubmitted"
        ? `${user.name} resubmitted request #${request.requestNumber} after rejection for review`
        : `${user.name} (${user.role === "sales_rep" ? "Sales Rep" : user.role === "branch_manager" ? "Branch Manager" : user.role === "category_manager" ? "Category Manager" : user.role === "planning" ? "Planning" : "Admin"}) edited request #${request.requestNumber}`;

      for (const targetId of notifyTargets) {
        await storage.createNotification(
          targetId,
          notifTitle,
          notifMsg,
          `/requests/${requestId}`
        );
      }

      const emailChangedFields: { fieldAr: string; fieldEn: string; oldValue: string; newValue: string }[] = [
        ...headerChangedFields,
        ...itemChanges.map(ic => {
          if (ic.action === "added") return { fieldAr: `📦 صنف مضاف: ${ic.itemCode}`, fieldEn: `📦 Added Item: ${ic.itemCode}`, oldValue: "-", newValue: `${ic.description} (الكمية: ${ic.qty})` };
          if (ic.action === "removed") return { fieldAr: `🗑 صنف محذوف: ${ic.itemCode}`, fieldEn: `🗑 Removed Item: ${ic.itemCode}`, oldValue: `${ic.description} (الكمية: ${ic.oldQty})`, newValue: "-" };
          return { fieldAr: `✏️ كمية: ${ic.itemCode}`, fieldEn: `✏️ Qty Changed: ${ic.itemCode}`, oldValue: String(ic.oldQty), newValue: String(ic.newQty) };
        }),
      ];

      const editEmailRecipients = collectRecipients(allUsers, {
        createdById: request.createdBy,
        salesRepId: request.salesRepId,
        branchId: request.branchId,
        productCategoryId: request.productCategoryId,
        actorId: user.id,
        notifyRoles: ["branch_manager", "category_manager", "planning", "sector_head"],
      });
      sendOrderEmail({
        eventType: "request_edited",
        recipients: editEmailRecipients,
        requestNumber: request.requestNumber,
        requestId,
        projectName: projectName || request.projectName,
        actorName: user.name,
        actorRole: user.role,
        notes,
        changedFields: emailChangedFields.length > 0 ? emailChangedFields : undefined,
      }).catch(err => console.error("[Email] Background send error:", err));

      res.json({ message: "Request updated successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/requests/:id/release", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      if (!["sales_rep", "branch_manager", "admin", "planning"].includes(user.role)) {
        return res.status(403).json({ message: "Only Sales Reps, Branch Managers, Planning, or Admin can request stock release" });
      }

      const requestId = parseInt(String(req.params.id));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status === "expired" || request.status === "lost_opportunity" || request.status === "confirmed_lost_opportunity" || request.status === "closed") {
        return res.status(400).json({ message: "This request has expired. Stock release is no longer available." });
      }
      if (request.status !== "final_approved") {
        return res.status(400).json({ message: "Request must be final approved before stock release" });
      }
      if (request.reservationEndDate) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const endDate = new Date(request.reservationEndDate); endDate.setHours(0, 0, 0, 0);
        if (endDate.getTime() <= today.getTime()) {
          return res.status(400).json({ message: "This request's reservation has expired. Stock release is no longer available." });
        }
      }

      const { releaseType, notes } = req.body;
      if (!releaseType || !["full", "partial"].includes(releaseType)) {
        return res.status(400).json({ message: "Release type must be 'full' or 'partial'" });
      }

      const existingReleases = await storage.getStockReleasesByRequest(requestId);
      const hasPendingRelease = existingReleases.some(
        (r: any) => !["final_approved", "rejected"].includes(r.status)
      );
      if (hasPendingRelease) {
        return res.status(400).json({ message: "There is already a pending stock release for this request. Please wait for it to be processed." });
      }

      const items = await storage.getRequestItems(requestId);
      const releasableItems = items.filter(i => i.quantityRequested - i.quantityReleased > 0);
      if (releasableItems.length === 0) {
        return res.status(400).json({ message: "All items are already fully released" });
      }

      let releaseItemsData: { requestItemId: number; quantity: number }[];

      if (releaseType === "full") {
        releaseItemsData = releasableItems.map(i => ({
          requestItemId: i.id,
          quantity: i.quantityRequested - i.quantityReleased,
        }));
      } else {
        const parsed = stockReleaseSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
        }
        releaseItemsData = parsed.data.items;

        const itemMap = new Map(items.map(i => [i.id, i]));
        for (const ri of releaseItemsData) {
          const item = itemMap.get(ri.requestItemId);
          if (!item) {
            return res.status(400).json({ message: `Item ${ri.requestItemId} not found` });
          }
          const remaining = item.quantityRequested - item.quantityReleased;
          if (ri.quantity > remaining) {
            return res.status(400).json({ message: `Cannot release ${ri.quantity} of ${item.productName}. Remaining: ${remaining}` });
          }
        }
      }

      const branchId = user.branchId || request.branchId;
      const release = await storage.createStockRelease({
        requestId,
        createdBy: user.id,
        releaseType,
        branchId,
        notes,
      });

      for (const ri of releaseItemsData) {
        await storage.createStockReleaseItem(release.id, ri.requestItemId, ri.quantity);
      }

      const isStrategicRelease = request.salesChannel === "strategic_reservation" && (user.role === "planning" || user.role === "admin");

      if (isStrategicRelease) {
        await storage.updateStockReleaseStatus(release.id, "final_approved");
        const currentItems = await storage.getRequestItems(requestId);
        const itemMap = new Map(currentItems.map(i => [i.id, i]));
        for (const ri of releaseItemsData) {
          const item = itemMap.get(ri.requestItemId);
          if (item) {
            const remaining = item.quantityRequested - item.quantityReleased;
            const safeQty = Math.min(ri.quantity, remaining);
            if (safeQty > 0) {
              await storage.updateRequestItemRelease(ri.requestItemId, safeQty);
            }
          }
        }
        const itemsAfterRelease = await storage.getRequestItems(requestId);
        const allFullyReleased = itemsAfterRelease.length > 0 && itemsAfterRelease.every(i => i.quantityReleased >= i.quantityRequested);
        if (allFullyReleased) {
          await db.update(requests).set({ status: "closed" as any, updatedAt: new Date() }).where(eq(requests.id, requestId));
          await storage.createAuditLog({
            userId: user.id,
            action: "auto_closed_fully_released",
            entity: "request",
            entityId: requestId,
            oldData: { status: "final_approved" },
            newData: { status: "closed" },
          });
        }
        await storage.createApproval({ requestId, role: user.role, action: "approve", notes: "Auto-approved (strategic reservation)", userId: user.id });
        await storage.createAuditLog({
          userId: user.id,
          action: "auto-approved strategic stock release",
          entity: "request",
          entityId: requestId,
          newData: { releaseId: release.id, releaseType, items: releaseItemsData, salesChannel: "strategic_reservation" },
        });
        res.json({ message: "Stock release auto-approved for strategic reservation", releaseId: release.id });
      } else {
        await storage.createAuditLog({
          userId: user.id,
          action: "requested stock release",
          entity: "request",
          entityId: requestId,
          newData: { releaseId: release.id, releaseType, items: releaseItemsData },
        });

        const allUsers = await storage.getUsers();
        const branchManagerIds3 = await getBranchManagerUserIds(branchId, allUsers);
        const branchManagers = allUsers.filter(u => branchManagerIds3.includes(u.id));
        const admins = allUsers.filter(u => u.role === "admin");
        const notifyUsers = [...branchManagers, ...admins];
        for (const nu of notifyUsers) {
          if (nu.id !== user.id) {
            await storage.createNotification(
              nu.id,
              "Stock Release Request",
              `${user.name} requested ${releaseType} stock release for #${request.requestNumber}`,
              `/requests/${requestId}`
            );
          }
        }

        const releaseEmailRecipients = collectRecipients(allUsers, {
          createdById: request.createdBy,
          salesRepId: request.salesRepId,
          branchId,
          productCategoryId: request.productCategoryId,
          actorId: user.id,
          notifyRoles: ["branch_manager"],
        });
        sendOrderEmail({
          eventType: "stock_release_requested",
          recipients: releaseEmailRecipients,
          requestNumber: request.requestNumber,
          requestId,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes,
          releaseType,
        }).catch(err => console.error("[Email] Background send error:", err));

        res.json({ message: "Stock release request submitted", releaseId: release.id });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/stock-releases/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const releaseId = parseInt(String(req.params.id));
      const release = await storage.getStockReleaseById(releaseId);
      if (!release) return res.status(404).json({ message: "Stock release not found" });

      if (release.status !== "submitted") {
        return res.status(400).json({ message: "Cannot edit: stock release has already been processed" });
      }

      if (release.createdBy !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Only the creator can edit this stock release" });
      }

      const request = await storage.getRequestById(release.requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const { releaseType, notes, items: bodyItems } = req.body;
      if (releaseType && !["full", "partial"].includes(releaseType)) {
        return res.status(400).json({ message: "Release type must be 'full' or 'partial'" });
      }

      const newType = releaseType || release.releaseType;
      const requestItemsList = await storage.getRequestItems(release.requestId);
      const itemMap = new Map(requestItemsList.map(i => [i.id, i]));

      let newItems: { requestItemId: number; quantity: number }[];

      if (newType === "full") {
        newItems = requestItemsList
          .filter(i => i.quantityRequested - i.quantityReleased > 0)
          .map(i => ({ requestItemId: i.id, quantity: i.quantityRequested - i.quantityReleased }));
        if (newItems.length === 0) {
          return res.status(400).json({ message: "All items are already fully released" });
        }
      } else {
        if (!Array.isArray(bodyItems) || bodyItems.length === 0) {
          return res.status(400).json({ message: "items array is required for partial release" });
        }
        newItems = bodyItems.map((x: any) => ({ requestItemId: Number(x.requestItemId), quantity: Number(x.quantity) }));
        for (const ri of newItems) {
          if (!Number.isInteger(ri.requestItemId) || !Number.isInteger(ri.quantity) || ri.quantity <= 0) {
            return res.status(400).json({ message: "Invalid item entry" });
          }
          const item = itemMap.get(ri.requestItemId);
          if (!item) return res.status(400).json({ message: `Item ${ri.requestItemId} not found` });
          const remaining = item.quantityRequested - item.quantityReleased;
          if (ri.quantity > remaining) {
            return res.status(400).json({ message: `Cannot release ${ri.quantity} of ${item.productName}. Remaining: ${remaining}` });
          }
        }
      }

      await db.transaction(async (tx) => {
        await tx.update(stockReleases).set({
          releaseType: newType as any,
          notes: notes !== undefined ? notes : release.notes,
          updatedAt: new Date(),
        }).where(eq(stockReleases.id, releaseId));
        await tx.delete(stockReleaseItems).where(eq(stockReleaseItems.stockReleaseId, releaseId));
      });
      for (const ri of newItems) {
        await storage.createStockReleaseItem(releaseId, ri.requestItemId, ri.quantity);
      }

      await storage.createAuditLog({
        userId: user.id,
        action: "edited stock release",
        entity: "request",
        entityId: release.requestId,
        oldData: { releaseId, releaseType: release.releaseType, notes: release.notes, items: release.items?.map((i: any) => ({ requestItemId: i.requestItemId, quantity: i.quantity })) },
        newData: { releaseId, releaseType: newType, notes: notes !== undefined ? notes : release.notes, items: newItems },
      });

      res.json({ message: "Stock release updated", releaseId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/stock-releases/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const releaseId = parseInt(String(req.params.id));
      const release = await storage.getStockReleaseById(releaseId);
      if (!release) return res.status(404).json({ message: "Stock release not found" });

      if (release.status !== "submitted") {
        return res.status(400).json({ message: "Cannot delete: stock release has already been processed" });
      }

      if (release.createdBy !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Only the creator can delete this stock release" });
      }

      await db.transaction(async (tx) => {
        await tx.delete(stockReleaseItems).where(eq(stockReleaseItems.stockReleaseId, releaseId));
        await tx.delete(stockReleases).where(eq(stockReleases.id, releaseId));
      });

      await storage.createAuditLog({
        userId: user.id,
        action: "deleted stock release",
        entity: "request",
        entityId: release.requestId,
        oldData: { releaseId, releaseType: release.releaseType, notes: release.notes, items: release.items?.map((i: any) => ({ requestItemId: i.requestItemId, quantity: i.quantity })) },
      });

      res.json({ message: "Stock release deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/stock-releases/:id/approve", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const releaseId = parseInt(String(req.params.id));
      const release = await storage.getStockReleaseById(releaseId);
      if (!release) return res.status(404).json({ message: "Stock release not found" });

      const { action, notes } = req.body;
      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "Invalid action" });
      }

      const canApprove = (role: string, status: string) => {
        if (role === "admin") return status !== "rejected" && status !== "final_approved";
        if (role === "branch_manager") return status === "submitted";
        if (role === "planning") return status === "branch_approved";
        return false;
      };

      if (!canApprove(user.role, release.status)) {
        return res.status(403).json({ message: "You cannot approve/reject this stock release at this stage" });
      }

      if (user.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(user.id, user.branchId);
        if (!branchIds.includes(release.branchId)) {
          return res.status(403).json({ message: "You can only approve stock releases from your branch" });
        }
      }

      const request = await storage.getRequestById(release.requestId);

      if (action === "reject") {
        // Determine rollback target
        let revertedReleaseStatus: string;
        let returnedToRole: string | null = null;
        if (user.role === "branch_manager" || (user.role === "admin" && release.status === "submitted")) {
          // First-stage reject → terminal
          revertedReleaseStatus = "rejected";
          returnedToRole = "creator";
        } else if (user.role === "planning" || (user.role === "admin" && release.status === "branch_approved")) {
          // Planning reject → revert to branch_manager
          revertedReleaseStatus = "submitted";
          returnedToRole = "branch_manager";
        } else {
          revertedReleaseStatus = "rejected";
          returnedToRole = "creator";
        }

        await storage.updateStockReleaseStatus(releaseId, revertedReleaseStatus);
        await storage.createAuditLog({
          userId: user.id,
          action: revertedReleaseStatus === "rejected" ? "rejected stock release" : "rejected and returned stock release",
          entity: "request",
          entityId: release.requestId,
          oldData: { releaseStatus: release.status },
          newData: { releaseId, releaseStatus: revertedReleaseStatus, notes, rejectedByRole: user.role, returnedToRole },
        });
        await storage.createNotification(
          release.createdBy,
          revertedReleaseStatus === "rejected" ? "Stock Release Rejected" : "Stock Release Returned",
          revertedReleaseStatus === "rejected"
            ? `Stock release for #${request?.requestNumber} was rejected by ${user.name}`
            : `Stock release for #${request?.requestNumber} was rejected by ${user.name}, returned to ${returnedToRole} for re-review`,
          `/requests/${release.requestId}`
        );

        // Also notify sales rep if different from creator
        if (request && request.salesRepId && request.salesRepId !== release.createdBy && request.salesRepId !== user.id) {
          await storage.createNotification(
            request.salesRepId,
            revertedReleaseStatus === "rejected" ? "Stock Release Rejected" : "Stock Release Returned",
            revertedReleaseStatus === "rejected"
              ? `Stock release for #${request.requestNumber} was rejected by ${user.name}`
              : `Stock release for #${request.requestNumber} was rejected by ${user.name}, returned to ${returnedToRole} for re-review`,
            `/requests/${release.requestId}`
          );
        }

        // Notify previous approver(s) when reverting
        if (revertedReleaseStatus !== "rejected" && returnedToRole === "branch_manager") {
          const allUsers = await storage.getUsers();
          const bms = allUsers.filter(u => u.role === "branch_manager");
          for (const bm of bms) {
            if (bm.id === user.id) continue;
            const ids = await storage.getUserBranchIds(bm.id, bm.branchId);
            if (ids.includes(release.branchId)) {
              await storage.createNotification(
                bm.id,
                "Stock Release Returned for Re-Review",
                `Stock release for #${request?.requestNumber} was rejected by ${user.name} and needs your re-review`,
                `/requests/${release.requestId}`
              );
            }
          }
        }
      } else {
        let newStatus: string;
        if (user.role === "branch_manager" || (user.role === "admin" && release.status === "submitted")) {
          newStatus = "branch_approved";
        } else {
          newStatus = "final_approved";
        }

        await storage.updateStockReleaseStatus(releaseId, newStatus);

        if (newStatus === "final_approved") {
          const currentItems = await storage.getRequestItems(release.requestId);
          const itemMap = new Map(currentItems.map(i => [i.id, i]));
          for (const ri of release.items) {
            const item = itemMap.get(ri.requestItemId);
            if (item) {
              const remaining = item.quantityRequested - item.quantityReleased;
              const safeQty = Math.min(ri.quantity, remaining);
              if (safeQty > 0) {
                await storage.updateRequestItemRelease(ri.requestItemId, safeQty);
              }
            }
          }
          const itemsAfterRelease = await storage.getRequestItems(release.requestId);
          const allFullyReleased = itemsAfterRelease.length > 0 && itemsAfterRelease.every(i => i.quantityReleased >= i.quantityRequested);
          if (allFullyReleased) {
            await db.update(requests).set({ status: "closed" as any, updatedAt: new Date() }).where(eq(requests.id, release.requestId));
            await storage.createAuditLog({
              userId: user.id,
              action: "auto_closed_fully_released",
              entity: "request",
              entityId: release.requestId,
              oldData: { status: request?.status || "final_approved" },
              newData: { status: "closed" },
            });
          }
          await storage.createNotification(
            release.createdBy,
            "Stock Released",
            `Stock release for #${request?.requestNumber} has been final approved and released${allFullyReleased ? " — request fully released and closed" : ""}`,
            `/requests/${release.requestId}`
          );
        } else {
          await storage.createNotification(
            release.createdBy,
            "Stock Release Approved",
            `Stock release for #${request?.requestNumber} was approved by ${user.name}`,
            `/requests/${release.requestId}`
          );

          const allUsers = await storage.getUsers();
          if (newStatus === "branch_approved") {
            const planners = allUsers.filter(u => u.role === "planning");
            for (const p of planners) {
              await storage.createNotification(p.id, "Stock Release Pending", `Stock release for #${request?.requestNumber} needs your approval`, `/requests/${release.requestId}`);
            }
          }
        }

        await storage.createAuditLog({
          userId: user.id,
          action: `approved stock release (${newStatus})`,
          entity: "request",
          entityId: release.requestId,
          newData: { releaseId, newStatus, notes },
        });
      }

      if (request) {
        const allUsersForEmail = await storage.getUsers();
        if (action === "reject") {
          const emailRecipients = collectRecipients(allUsersForEmail, {
            createdById: request.createdBy,
            salesRepId: request.salesRepId,
            branchId: request.branchId,
            productCategoryId: request.productCategoryId,
            actorId: user.id,
            notifyRoles: ["branch_manager"],
          });
          sendOrderEmail({
            eventType: "stock_release_rejected",
            recipients: emailRecipients,
            requestNumber: request.requestNumber,
            requestId: release.requestId,
            projectName: request.projectName,
            actorName: user.name,
            actorRole: user.role,
            notes,
          }).catch(err => console.error("[Email] Background send error:", err));
        } else {
          const srNewStatus = user.role === "branch_manager" || (user.role === "admin" && release.status === "submitted")
            ? "branch_approved"
            : "final_approved";
          const nextRoles: string[] = [];
          if (srNewStatus === "branch_approved") nextRoles.push("planning");
          if (srNewStatus === "final_approved") nextRoles.push("sector_head");
          const emailRecipients = collectRecipients(allUsersForEmail, {
            createdById: request.createdBy,
            salesRepId: request.salesRepId,
            branchId: request.branchId,
            productCategoryId: request.productCategoryId,
            actorId: user.id,
            notifyRoles: ["branch_manager", ...nextRoles],
          });
          sendOrderEmail({
            eventType: srNewStatus === "final_approved" ? "stock_release_final_approved" : "stock_release_approved",
            recipients: emailRecipients,
            requestNumber: request.requestNumber,
            requestId: release.requestId,
            projectName: request.projectName,
            actorName: user.name,
            actorRole: user.role,
            notes,
            newStatus: srNewStatus,
          }).catch(err => console.error("[Email] Background send error:", err));
        }
      }

      res.json({ message: "Action completed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/requests/:id/update-end-date", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (!["planning", "sector_head", "admin"].includes(user.role)) {
        return res.status(403).json({ message: "Only planning, sector head, or admin can update end date" });
      }
      const requestId = parseInt(String(req.params.id));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const { newEndDate, reason } = req.body;
      if (!newEndDate) return res.status(400).json({ message: "newEndDate is required" });

      const oldEndDate = request.reservationEndDate;
      const oldStatus = request.status;
      const shouldReactivate = ["expired", "lost_opportunity"].includes(oldStatus);
      const newStatus = shouldReactivate ? "final_approved" : oldStatus;

      await db.update(requests).set({
        reservationEndDate: newEndDate,
        ...(shouldReactivate ? { status: newStatus as any } : {}),
        updatedAt: new Date(),
      }).where(eq(requests.id, requestId));

      await storage.createAuditLog({
        userId: user.id,
        action: "update_end_date",
        entity: "request",
        entityId: requestId,
        oldData: { reservationEndDate: oldEndDate, status: oldStatus, reason: reason || "" },
        newData: { reservationEndDate: newEndDate, ...(shouldReactivate ? { status: newStatus } : {}) },
      });

      res.json({ message: "End date updated", oldEndDate, newEndDate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/requests/:id/mark-lost", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (!["planning", "admin"].includes(user.role)) {
        return res.status(403).json({ message: "Only planning can convert to lost opportunity" });
      }
      const requestId = parseInt(String(req.params.id));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      if (request.status !== "expired") {
        return res.status(400).json({ message: "Only expired requests can be converted to lost opportunity" });
      }

      const activeExtensions = await db.select().from(requestExtensions)
        .where(eq(requestExtensions.requestId, requestId));
      const pendingExtensions = activeExtensions.filter(ext =>
        ext.status !== "approved" && ext.status !== "rejected"
      );

      for (const pe of pendingExtensions) {
        await db.update(requestExtensions)
          .set({ status: "rejected" as any, rejectionReason: "Auto-rejected: request converted to lost opportunity" })
          .where(eq(requestExtensions.id, pe.id));
        await storage.createAuditLog({
          userId: user.id,
          action: "auto-rejected extension (lost opportunity)",
          entity: "request",
          entityId: requestId,
          oldData: { extensionId: pe.id, status: pe.status },
          newData: { status: "rejected" },
        });
      }

      await db.update(requests).set({ status: "lost_opportunity" as any, updatedAt: new Date() }).where(eq(requests.id, requestId));

      await storage.createAuditLog({
        userId: user.id,
        action: "manual_mark_lost_opportunity",
        entity: "request",
        entityId: requestId,
        oldData: { status: "expired" },
        newData: { status: "lost_opportunity" },
      });

      const allUsers = await storage.getUsers();
      const notifySet = new Set<number>();
      const creator = allUsers.find(u => u.id === request.createdBy);
      const salesRep = request.salesRepId ? allUsers.find(u => u.id === request.salesRepId) : null;
      if (creator) notifySet.add(creator.id);
      if (salesRep) notifySet.add(salesRep.id);
      const bmIds = await getBranchManagerUserIds(request.branchId, allUsers);
      bmIds.forEach(id => notifySet.add(id));
      allUsers.filter(u => u.role === "planning" || u.role === "admin").forEach(u => notifySet.add(u.id));
      allUsers.filter(u => u.role === "category_manager" && u.productCategoryId && u.productCategoryId === request.productCategoryId).forEach(u => notifySet.add(u.id));
      notifySet.delete(user.id);

      for (const userId of notifySet) {
        await storage.createNotification(
          userId,
          "Lost Opportunity",
          `Request #${request.requestNumber} has been manually converted to Lost Opportunity by ${user.name}.`,
          `/requests/${request.id}`
        );
      }

      const emailRecipients = [...notifySet].map(uid => {
        const u = allUsers.find(usr => usr.id === uid);
        return u ? { email: u.email, name: u.name, userId: u.id } : null;
      }).filter(Boolean) as { email: string; name: string; userId: number }[];

      if (emailRecipients.length > 0) {
        sendOrderEmail({
          eventType: "request_rejected" as EmailEventType,
          recipients: emailRecipients,
          requestNumber: request.requestNumber,
          requestId: request.id,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes: `Request #${request.requestNumber} has been manually converted to Lost Opportunity by ${user.name}.\nالطلب #${request.requestNumber} تم تحويله يدوياً إلى فرصة ضائعة بواسطة ${user.name}.`,
        }).catch(err => console.error("[Email] Manual lost opportunity error:", err));
      }

      res.json({ message: "Request converted to lost opportunity", status: "lost_opportunity" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/requests/:id/mark-confirmed-lost", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (!["planning", "admin"].includes(user.role)) {
        return res.status(403).json({ message: "Only planning can confirm lost opportunity" });
      }
      const requestId = parseInt(String(req.params.id));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      if (request.status !== "lost_opportunity") {
        return res.status(400).json({ message: "Only lost opportunity requests can be confirmed" });
      }

      await db.update(requests).set({ status: "confirmed_lost_opportunity" as any, updatedAt: new Date() }).where(eq(requests.id, requestId));

      await storage.createAuditLog({
        userId: user.id,
        action: "manual_mark_confirmed_lost_opportunity",
        entity: "request",
        entityId: requestId,
        oldData: { status: "lost_opportunity" },
        newData: { status: "confirmed_lost_opportunity" },
      });

      const allUsers = await storage.getUsers();
      const notifySet = new Set<number>();
      const creator = allUsers.find(u => u.id === request.createdBy);
      const salesRep = request.salesRepId ? allUsers.find(u => u.id === request.salesRepId) : null;
      if (creator) notifySet.add(creator.id);
      if (salesRep) notifySet.add(salesRep.id);
      const bmIds = await getBranchManagerUserIds(request.branchId, allUsers);
      bmIds.forEach(id => notifySet.add(id));
      allUsers.filter(u => u.role === "planning" || u.role === "admin").forEach(u => notifySet.add(u.id));
      allUsers.filter(u => u.role === "category_manager" && u.productCategoryId && u.productCategoryId === request.productCategoryId).forEach(u => notifySet.add(u.id));
      notifySet.delete(user.id);

      for (const userId of notifySet) {
        await storage.createNotification(
          userId,
          "Confirmed Lost Opportunity",
          `Request #${request.requestNumber} has been marked as Confirmed Lost Opportunity by ${user.name}.`,
          `/requests/${request.id}`
        );
      }

      const emailRecipients = [...notifySet].map(uid => {
        const u = allUsers.find(usr => usr.id === uid);
        return u ? { email: u.email, name: u.name, userId: u.id } : null;
      }).filter(Boolean) as { email: string; name: string; userId: number }[];

      if (emailRecipients.length > 0) {
        sendOrderEmail({
          eventType: "request_rejected" as EmailEventType,
          recipients: emailRecipients,
          requestNumber: request.requestNumber,
          requestId: request.id,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes: `Request #${request.requestNumber} has been marked as Confirmed Lost Opportunity by ${user.name}.\nالطلب #${request.requestNumber} تم تحويله إلى فرصة ضائعة مؤكدة بواسطة ${user.name}.`,
        }).catch(err => console.error("[Email] Confirmed lost opportunity error:", err));
      }

      res.json({ message: "Request marked as confirmed lost opportunity", status: "confirmed_lost_opportunity" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/requests/:id/extend", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const requestId = parseInt(String(req.params.id));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      if (!["final_approved", "expired"].includes(request.status)) {
        return res.status(400).json({ message: "Only final approved or expired requests can be extended" });
      }

      const hasUnreleased = request.items.some((i: any) => i.quantityReleased < i.quantityRequested);
      if (!hasUnreleased) {
        return res.status(400).json({ message: "All items are fully released" });
      }

      const parsed = createExtensionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      }

      const { requestedDays, notes } = parsed.data;
      const previousExpiryDate = request.reservationEndDate || request.requestDate;
      const prevDate = new Date(previousExpiryDate);
      const newDate = new Date(prevDate);
      newDate.setDate(newDate.getDate() + requestedDays);
      const newExpiryDate = newDate.toISOString().split("T")[0];

      const creationDate = new Date(request.createdAt);
      const totalDaysFromCreation = Math.ceil((newDate.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24));

      const pendingStatuses = ["pending_branch", "pending_category", "pending_planning", "pending_sector_head"];
      let extension: any;
      try {
        extension = await db.transaction(async (tx) => {
          const existingExts = await tx.select().from(requestExtensions).where(eq(requestExtensions.requestId, requestId));
          const hasPending = existingExts.some(e => pendingStatuses.includes(e.status));
          if (hasPending) {
            throw new Error("PENDING_EXISTS");
          }
          const [ext] = await tx.insert(requestExtensions).values({
            requestId,
            requestedBy: user.id,
            requestedDays,
            previousExpiryDate,
            newExpiryDate,
            totalDaysFromCreation,
            status: "pending_branch" as any,
            notes,
          }).returning();
          return ext;
        });
      } catch (txErr: any) {
        if (txErr.message === "PENDING_EXISTS") {
          return res.status(400).json({ message: "There is already a pending extension for this request. Please wait for it to be processed before creating a new one." });
        }
        throw txErr;
      }

      await storage.createAuditLog({
        userId: user.id,
        action: "requested extension",
        entity: "request",
        entityId: requestId,
        newData: { extensionId: extension.id, requestedDays, newExpiryDate, totalDaysFromCreation },
      });

      const allUsers = await storage.getUsers();
      const branchManagerIds4 = await getBranchManagerUserIds(request.branchId, allUsers);
      const branchManagers = allUsers.filter(u => branchManagerIds4.includes(u.id) && u.id !== user.id);
      for (const bm of branchManagers) {
        await storage.createNotification(
          bm.id,
          "Extension Request",
          `Extension requested for #${request.requestNumber} (${requestedDays} days)`,
          `/requests/${requestId}`
        );
      }
      const admins = allUsers.filter(u => u.role === "admin" && u.id !== user.id);
      for (const a of admins) {
        await storage.createNotification(
          a.id,
          "Extension Request",
          `Extension requested for #${request.requestNumber} (${requestedDays} days)`,
          `/requests/${requestId}`
        );
      }

      const recipients = collectRecipients(allUsers, {
        createdById: request.createdBy,
        salesRepId: request.salesRepId,
        branchId: request.branchId,
        productCategoryId: request.productCategoryId,
        actorId: user.id,
        notifyRoles: ["branch_manager"],
      });
      sendOrderEmail({
        eventType: "extension_requested",
        recipients,
        requestNumber: request.requestNumber,
        requestId,
        projectName: request.projectName,
        actorName: user.name,
        actorRole: user.role,
        notes: `Extension: ${requestedDays} days requested. New expiry: ${newExpiryDate}`,
      }).catch(console.error);

      res.json({ message: "Extension request submitted", extension });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/extensions/pending-my-action", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const roleStatusMap: Record<string, string> = {
        branch_manager: "pending_branch",
        category_manager: "pending_category",
        planning: "pending_planning",
        sector_head: "pending_sector_head",
      };
      const pendingStatus = roleStatusMap[user.role];
      if (!pendingStatus) return res.json({ requestIds: [] });

      // Extension request IDs
      const allExtensions = await db.select().from(requestExtensions).where(eq(requestExtensions.status, pendingStatus as any));
      let extRequestIds = new Set(allExtensions.map(e => e.requestId));

      if (user.role === "branch_manager" && extRequestIds.size > 0) {
        const bmBranchIds = await storage.getUserBranchIds(user.id, user.branchId);
        const extReqs = await db.select().from(requests).where(inArray(requests.id, [...extRequestIds]));
        extRequestIds = new Set(extReqs.filter(r => bmBranchIds.includes(r.branchId)).map(r => r.id));
      }
      if (user.role === "category_manager" && user.productCategoryId && extRequestIds.size > 0) {
        const extReqs = await db.select().from(requests).where(inArray(requests.id, [...extRequestIds]));
        extRequestIds = new Set(extReqs.filter(r => r.productCategoryId === user.productCategoryId).map(r => r.id));
      }

      // For sector_head: also include main requests at category_approved with duration > 90 and no sector_head approval yet
      let mainRequestIds: number[] = [];
      if (user.role === "sector_head") {
        const allRequests = await storage.getRequests(user);
        const categoryApprovedLong = allRequests.filter(r => r.status === "category_approved" && parseInt(r.reservationDuration || "0") > 90);
        for (const r of categoryApprovedLong) {
          const reqApprovals = await storage.getApprovalsByRequest(r.id);
          const alreadyApproved = reqApprovals.some(a => a.role === "sector_head" && a.action === "approve");
          if (!alreadyApproved) mainRequestIds.push(r.id);
        }
      }

      const requestIds = [...new Set([...extRequestIds, ...mainRequestIds])];
      res.json({ requestIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/extensions/:requestId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const requestId = parseInt(String(req.params.requestId));
      const extensions = await storage.getExtensionsByRequest(requestId);
      res.json(extensions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/extensions/:id/approve", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const extensionId = parseInt(String(req.params.id));
      const extension = await storage.getExtensionById(extensionId);
      if (!extension) return res.status(404).json({ message: "Extension not found" });

      const request = await storage.getRequestById(extension.requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const { action, notes, newExpiryDate: editedExpiryDate } = req.body;
      if (!action || !["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "Action must be approve or reject" });
      }

      let editApplied: { oldDate: string; newDate: string; oldDays: number; newDays: number; oldTotal: number; newTotal: number } | null = null;
      if (action === "approve" && editedExpiryDate && editedExpiryDate !== extension.newExpiryDate) {
        if (!["planning", "sector_head", "admin"].includes(user.role)) {
          return res.status(403).json({ message: "Only Planning, Sector Head, or Admin can edit the new expiry date" });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(editedExpiryDate)) {
          return res.status(400).json({ message: "Invalid date format (YYYY-MM-DD expected)" });
        }
        const prevDate = new Date(extension.previousExpiryDate);
        const newDate = new Date(editedExpiryDate);
        if (newDate <= prevDate) {
          return res.status(400).json({ message: "New expiry date must be after previous expiry date" });
        }
        const creationDate = new Date(request.createdAt);
        const newRequestedDays = Math.ceil((newDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        const newTotalDays = Math.ceil((newDate.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24));
        editApplied = {
          oldDate: extension.newExpiryDate,
          newDate: editedExpiryDate,
          oldDays: extension.requestedDays,
          newDays: newRequestedDays,
          oldTotal: extension.totalDaysFromCreation,
          newTotal: newTotalDays,
        };
        await db.update(requestExtensions).set({
          newExpiryDate: editedExpiryDate,
          requestedDays: newRequestedDays,
          totalDaysFromCreation: newTotalDays,
        }).where(eq(requestExtensions.id, extensionId));
        extension.newExpiryDate = editedExpiryDate;
        extension.requestedDays = newRequestedDays;
        extension.totalDaysFromCreation = newTotalDays;

        await storage.createAuditLog({
          userId: user.id,
          action: "edited extension",
          entity: "request",
          entityId: extension.requestId,
          oldData: { newExpiryDate: editApplied.oldDate, requestedDays: editApplied.oldDays, totalDaysFromCreation: editApplied.oldTotal },
          newData: { newExpiryDate: editApplied.newDate, requestedDays: editApplied.newDays, totalDaysFromCreation: editApplied.newTotal, editedBy: user.name, role: user.role, notes: notes || null },
        });

        await storage.createApproval({
          requestId: extension.requestId,
          role: user.role,
          action: "edit",
          type: "extension",
          notes: `Extension edited: end date ${editApplied.oldDate} → ${editApplied.newDate} (${editApplied.oldDays}d → ${editApplied.newDays}d). ${notes ? `Notes: ${notes}` : ""}`,
          userId: user.id,
        });
      }

      const canApprove = async (role: string, status: string): Promise<boolean> => {
        if (role === "admin") return status !== "rejected" && status !== "approved";
        if (role === "branch_manager") {
          const bmBranchIds = await storage.getUserBranchIds(user.id, user.branchId);
          return status === "pending_branch" && bmBranchIds.includes(request.branchId);
        }
        if (role === "category_manager") return status === "pending_category";
        if (role === "planning") return status === "pending_planning";
        if (role === "sector_head") return status === "pending_sector_head";
        return false;
      };

      if (!(await canApprove(user.role, extension.status))) {
        return res.status(403).json({ message: "You cannot approve this extension" });
      }

      if (action === "reject") {
        // Determine rollback target based on rejector's stage
        let revertedExtStatus: string;
        let returnedToRole: string | null = null;
        if (user.role === "branch_manager" || (user.role === "admin" && extension.status === "pending_branch")) {
          revertedExtStatus = "rejected";
          returnedToRole = "requester";
        } else if (user.role === "category_manager" || (user.role === "admin" && extension.status === "pending_category")) {
          revertedExtStatus = "pending_branch";
          returnedToRole = "branch_manager";
        } else if (user.role === "planning" || (user.role === "admin" && extension.status === "pending_planning")) {
          revertedExtStatus = "pending_category";
          returnedToRole = "category_manager";
        } else if (user.role === "sector_head" || (user.role === "admin" && extension.status === "pending_sector_head")) {
          revertedExtStatus = "pending_planning";
          returnedToRole = "planning";
        } else {
          revertedExtStatus = "rejected";
          returnedToRole = "requester";
        }

        await storage.updateExtensionStatus(extensionId, revertedExtStatus, notes);

        const trailNote = revertedExtStatus === "rejected"
          ? `Extension rejected by ${user.role}.${notes ? ` Reason: ${notes}` : ""}`
          : `Extension rejected by ${user.role}, returned to ${returnedToRole} for re-review.${notes ? ` Reason: ${notes}` : ""}`;

        await storage.createApproval({
          requestId: extension.requestId,
          role: user.role,
          action: "reject",
          type: "extension",
          notes: trailNote,
          userId: user.id,
        });

        await storage.createAuditLog({
          userId: user.id,
          action: revertedExtStatus === "rejected" ? "rejected extension" : "rejected and returned extension",
          entity: "request",
          entityId: extension.requestId,
          oldData: { extensionStatus: extension.status },
          newData: { extensionStatus: revertedExtStatus, notes, rejectedByRole: user.role, returnedToRole },
        });

        const allUsers = await storage.getUsers();
        const requester = allUsers.find(u => u.id === extension.requestedBy);
        if (requester && requester.id !== user.id) {
          await storage.createNotification(
            requester.id,
            revertedExtStatus === "rejected" ? "Extension Rejected" : "Extension Returned",
            revertedExtStatus === "rejected"
              ? `Extension for #${request.requestNumber} was rejected by ${user.name}`
              : `Extension for #${request.requestNumber} was rejected by ${user.name}, returned to ${returnedToRole} for re-review`,
            `/requests/${extension.requestId}`
          );
        }

        // Also notify sales rep if different from requester/creator
        if (request.salesRepId && request.salesRepId !== extension.requestedBy && request.salesRepId !== user.id && request.salesRepId !== request.createdBy) {
          await storage.createNotification(
            request.salesRepId,
            revertedExtStatus === "rejected" ? "Extension Rejected" : "Extension Returned",
            revertedExtStatus === "rejected"
              ? `Extension for #${request.requestNumber} was rejected by ${user.name}`
              : `Extension for #${request.requestNumber} was rejected by ${user.name}, returned to ${returnedToRole} for re-review`,
            `/requests/${extension.requestId}`
          );
        }
        if (request.createdBy !== extension.requestedBy && request.createdBy !== user.id) {
          await storage.createNotification(
            request.createdBy,
            revertedExtStatus === "rejected" ? "Extension Rejected" : "Extension Returned",
            revertedExtStatus === "rejected"
              ? `Extension for #${request.requestNumber} was rejected by ${user.name}`
              : `Extension for #${request.requestNumber} was rejected by ${user.name}, returned to ${returnedToRole} for re-review`,
            `/requests/${extension.requestId}`
          );
        }

        // Notify previous approver(s) so they can act
        if (revertedExtStatus !== "rejected" && returnedToRole) {
          let priorApprovers: any[] = [];
          if (returnedToRole === "branch_manager") {
            for (const u2 of allUsers.filter(u => u.role === "branch_manager")) {
              const ids = await storage.getUserBranchIds(u2.id, u2.branchId);
              if (ids.includes(request.branchId)) priorApprovers.push(u2);
            }
          } else if (returnedToRole === "category_manager") {
            priorApprovers = allUsers.filter(u => u.role === "category_manager" && u.productCategoryId === request.productCategoryId);
          } else if (returnedToRole === "planning") {
            priorApprovers = allUsers.filter(u => u.role === "planning");
          }
          for (const a of priorApprovers) {
            if (a.id === user.id) continue;
            await storage.createNotification(
              a.id,
              "Extension Returned for Re-Review",
              `Extension for #${request.requestNumber} was rejected by ${user.name} and needs your re-review`,
              `/requests/${extension.requestId}`
            );
          }
        }

        const recipients = collectRecipients(allUsers, {
          createdById: request.createdBy,
          salesRepId: request.salesRepId,
          branchId: request.branchId,
          productCategoryId: request.productCategoryId,
          actorId: user.id,
        });
        sendOrderEmail({
          eventType: "extension_rejected",
          recipients,
          requestNumber: request.requestNumber,
          requestId: extension.requestId,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes: notes || "Extension rejected",
        }).catch(console.error);

        return res.json({ message: revertedExtStatus === "rejected" ? "Extension rejected" : `Extension returned to ${returnedToRole}` });
      }

      const needsSectorHead = extension.totalDaysFromCreation > 90;
      let nextStatus: string;
      let isFinal = false;

      switch (extension.status) {
        case "pending_branch":
          nextStatus = "pending_category";
          break;
        case "pending_category":
          nextStatus = "pending_planning";
          break;
        case "pending_planning":
          if (needsSectorHead) {
            nextStatus = "pending_sector_head";
          } else {
            nextStatus = "approved";
            isFinal = true;
          }
          break;
        case "pending_sector_head":
          nextStatus = "approved";
          isFinal = true;
          break;
        default:
          return res.status(400).json({ message: "Invalid extension status" });
      }

      const currentStatusCheck = await db.select().from(requestExtensions).where(eq(requestExtensions.id, extensionId));
      if (!currentStatusCheck.length || currentStatusCheck[0].status !== extension.status) {
        return res.status(409).json({ message: "Extension status has changed. Please refresh and try again." });
      }

      await db.transaction(async (tx) => {
        const [updated] = await tx.update(requestExtensions)
          .set({ status: nextStatus })
          .where(and(eq(requestExtensions.id, extensionId), eq(requestExtensions.status, extension.status as any)))
          .returning();
        if (!updated) {
          throw new Error("CONCURRENT_MODIFICATION");
        }

        if (isFinal) {
          const allExts = await tx.select().from(requestExtensions).where(eq(requestExtensions.requestId, extension.requestId));
          const pendingStatuses = ["pending_branch", "pending_category", "pending_planning", "pending_sector_head"];
          for (const otherExt of allExts) {
            if (otherExt.id !== extensionId && pendingStatuses.includes(otherExt.status)) {
              await tx.update(requestExtensions)
                .set({ status: "rejected" as any, rejectionReason: "Auto-rejected: another extension was approved" })
                .where(eq(requestExtensions.id, otherExt.id));
            }
          }

          await tx.update(requests).set({
            reservationEndDate: extension.newExpiryDate,
            extensionCount: sql`COALESCE(${requests.extensionCount}, 0) + 1`,
            ...(request.status === "expired" ? { status: "final_approved" } : {}),
            updatedAt: new Date(),
          }).where(eq(requests.id, extension.requestId));
        }
      });

      await storage.createApproval({
        requestId: extension.requestId,
        role: user.role,
        action: "approve",
        type: "extension",
        notes: `Extension approved: ${notes || ""}`,
        userId: user.id,
      });

      if (isFinal) {

        await storage.createAuditLog({
          userId: user.id,
          action: "extension final approved",
          entity: "request",
          entityId: extension.requestId,
          oldData: { reservationEndDate: extension.previousExpiryDate },
          newData: { reservationEndDate: extension.newExpiryDate, extensionDays: extension.requestedDays },
        });

        const allUsers = await storage.getUsers();
        const bmIdsForNotify = await getBranchManagerUserIds(request.branchId, allUsers);
        const stakeholders = allUsers.filter(u =>
          u.id === request.createdBy ||
          u.id === request.salesRepId ||
          u.role === "admin" ||
          bmIdsForNotify.includes(u.id) ||
          (u.role === "category_manager" && u.productCategoryId && u.productCategoryId === request.productCategoryId) ||
          u.role === "planning"
        );
        for (const s of stakeholders) {
          if (s.id !== user.id) {
            await storage.createNotification(
              s.id,
              "Extension Approved",
              `Extension for #${request.requestNumber} approved. New expiry: ${extension.newExpiryDate}`,
              `/requests/${extension.requestId}`
            );
          }
        }

        const recipients = collectRecipients(allUsers, {
          createdById: request.createdBy,
          salesRepId: request.salesRepId,
          branchId: request.branchId,
          productCategoryId: request.productCategoryId,
          actorId: user.id,
          notifyRoles: ["branch_manager", "category_manager", "planning", "sector_head"],
        });
        sendOrderEmail({
          eventType: "extension_final_approved",
          recipients,
          requestNumber: request.requestNumber,
          requestId: extension.requestId,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes: `Extension approved: ${extension.requestedDays} days. New expiry: ${extension.newExpiryDate}`,
        }).catch(console.error);
      } else {
        await storage.createAuditLog({
          userId: user.id,
          action: "approved extension step",
          entity: "request",
          entityId: extension.requestId,
          oldData: { extensionStatus: extension.status },
          newData: { extensionStatus: nextStatus },
        });

        const allUsers = await storage.getUsers();
        const nextRoleMap: Record<string, string> = {
          pending_category: "category_manager",
          pending_planning: "planning",
          pending_sector_head: "sector_head",
        };
        const nextRole = nextRoleMap[nextStatus];
        if (nextRole) {
          const nextApprovers = allUsers.filter(u => u.role === nextRole && u.id !== user.id);
          for (const na of nextApprovers) {
            await storage.createNotification(
              na.id,
              "Extension Pending Approval",
              `Extension for #${request.requestNumber} needs your approval (${extension.requestedDays} days)`,
              `/requests/${extension.requestId}`
            );
          }
        }

        const recipients = collectRecipients(allUsers, {
          createdById: request.createdBy,
          salesRepId: request.salesRepId,
          branchId: request.branchId,
          productCategoryId: request.productCategoryId,
          actorId: user.id,
          notifyRoles: nextRole ? [nextRole] : [],
        });
        sendOrderEmail({
          eventType: "extension_approved",
          recipients,
          requestNumber: request.requestNumber,
          requestId: extension.requestId,
          projectName: request.projectName,
          actorName: user.name,
          actorRole: user.role,
          notes: `Extension step approved by ${user.name}. Status: ${nextStatus}`,
        }).catch(console.error);
      }

      res.json({ message: isFinal ? "Extension fully approved" : "Extension step approved", nextStatus });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/requests/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const requestId = parseInt(String(req.params.id));
      const request = await storage.getRequestById(requestId);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const canDelete = (role: string, status: string, isCreator: boolean) => {
        if (role === "admin" || role === "planning") return true;
        if (role === "sales_rep" && isCreator && status === "submitted") return true;
        return false;
      };

      if (!canDelete(user.role, request.status, request.createdBy === user.id)) {
        return res.status(403).json({ message: "You cannot delete this request" });
      }

      await storage.createAuditLog({
        userId: user.id,
        action: "deleted request",
        entity: "request",
        entityId: requestId,
        oldData: { 
          requestNumber: request.requestNumber,
          projectName: request.projectName,
          department: request.department,
          status: request.status
        },
      });

      await storage.deleteRequest(requestId);
      res.json({ message: "Request deleted successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stock-releases", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (!["planning", "admin", "category_manager"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const releases = await storage.getAllStockReleases();
      res.json(releases);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/notifications", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const notifs = await storage.getNotifications(user.id);
      res.json(notifs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/notifications/unread-count", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const count = await storage.getUnreadNotificationCount(user.id);
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notifications/:id/read", authMiddleware, async (req: Request, res: Response) => {
    try {
      await storage.markNotificationRead(parseInt(String(req.params.id)));
      res.json({ message: "Marked as read" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notifications/mark-all-read", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      await storage.markAllNotificationsRead(user.id);
      res.json({ message: "All marked as read" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/audit-logs", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (!["admin", "planning", "category_manager"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const logs = await storage.getAllAuditLogs();
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/users", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const users = await storage.getUsers();
      res.json(users);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/users", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { name, email, password, role, branchId, productCategoryId } = req.body;
      if (!name || !email || !password || !role) {
        return res.status(400).json({ message: "All fields are required" });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        name,
        email,
        password: hashedPassword,
        role,
        branchId: branchId ? parseInt(branchId) : null,
        productCategoryId: productCategoryId ? parseInt(productCategoryId) : null,
      });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/users/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const { name, email, password, role, branchId, productCategoryId } = req.body;
      const data: any = {};
      if (name) data.name = name;
      if (email) data.email = email;
      if (role) data.role = role;
      if (branchId !== undefined) data.branchId = branchId ? parseInt(branchId) : null;
      if (productCategoryId !== undefined) data.productCategoryId = productCategoryId ? parseInt(productCategoryId) : null;
      if (password) {
        data.password = await bcrypt.hash(password, 10);
      }
      const user = await storage.updateUser(id, data);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/users/:id", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteUser(id);
      res.json({ message: "User deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-preferences", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const [prefs] = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, user.id));
      if (!prefs) {
        return res.json({
          userId: user.id,
          requestCreated: true,
          requestApproved: true,
          requestRejected: true,
          requestFinalApproved: true,
          requestEdited: true,
          stockReleaseRequested: true,
          stockReleaseApproved: true,
          stockReleaseRejected: true,
          stockReleaseFinalApproved: true,
        });
      }
      res.json(prefs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/email-preferences", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const {
        requestCreated, requestApproved, requestRejected, requestFinalApproved,
        requestEdited, stockReleaseRequested, stockReleaseApproved,
        stockReleaseRejected, stockReleaseFinalApproved
      } = req.body;

      const values = {
        userId: user.id,
        requestCreated: requestCreated ?? true,
        requestApproved: requestApproved ?? true,
        requestRejected: requestRejected ?? true,
        requestFinalApproved: requestFinalApproved ?? true,
        requestEdited: requestEdited ?? true,
        stockReleaseRequested: stockReleaseRequested ?? true,
        stockReleaseApproved: stockReleaseApproved ?? true,
        stockReleaseRejected: stockReleaseRejected ?? true,
        stockReleaseFinalApproved: stockReleaseFinalApproved ?? true,
        updatedAt: new Date(),
      };

      const [existing] = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, user.id));
      if (existing) {
        const [updated] = await db.update(emailPreferences)
          .set(values)
          .where(eq(emailPreferences.userId, user.id))
          .returning();
        return res.json(updated);
      }
      const [created] = await db.insert(emailPreferences).values(values).returning();
      res.json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-logs", authMiddleware, roleMiddleware("admin"), async (req: Request, res: Response) => {
    try {
      const { eventType, status, requestId, recipientEmail, page = "1", limit = "50" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
      const offset = (pageNum - 1) * limitNum;

      const conditions: any[] = [];
      if (eventType && eventType !== "all") {
        conditions.push(eq(emailLogs.eventType, eventType as string));
      }
      if (status && status !== "all") {
        conditions.push(eq(emailLogs.status, status as string));
      }
      if (requestId) {
        conditions.push(eq(emailLogs.requestId, parseInt(requestId as string)));
      }
      if (recipientEmail) {
        conditions.push(ilike(emailLogs.recipientEmail, `%${recipientEmail}%`));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult] = await db.select({ count: sqlFn<number>`count(*)::int` })
        .from(emailLogs)
        .where(where);
      const total = countResult?.count ?? 0;

      const logs = await db.select().from(emailLogs)
        .where(where)
        .orderBy(desc(emailLogs.createdAt))
        .limit(limitNum)
        .offset(offset);

      res.json({
        logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/expiring-requests", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const allRequests = await storage.getRequests(user.id, user.role, user.branchId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const expiringRequests = allRequests.filter((r: any) => {
        if (r.status !== "final_approved") return false;
        if (!r.reservationEndDate) return false;
        const hasUnreleased = r.items?.some((i: any) => i.quantityRequested - i.quantityReleased > 0);
        if (!hasUnreleased) return false;

        const endDate = new Date(r.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 3 && diffDays >= -7;
      });

      res.json(expiringRequests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/sales-rep", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const allReqs = await storage.getRequests(user.id, user.role, user.branchId);
      const myReqs = user.role === "sales_rep" 
        ? allReqs.filter(r => r.createdBy === user.id || r.sales_rep_id === user.id)
        : allReqs;

      const totalReserved = myReqs.reduce((sum, r) => 
        sum + r.items.reduce((s, i) => s + i.quantityRequested, 0), 0);
      const totalReleased = myReqs.reduce((sum, r) => 
        sum + r.items.reduce((s, i) => s + i.quantityReleased, 0), 0);
      const totalFrozen = totalReserved - totalReleased;

      const totalSalesValue = myReqs.reduce((sum, r) => 
        sum + r.items.reduce((s, i) => s + (i.quantityRequested * Number(i.sellingPrice || 0)), 0), 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(today.getDate() + 3);

      const expiringSoonCount = myReqs.filter(r => {
        if (r.status !== "final_approved" || !r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        return endDate >= today && endDate <= threeDaysLater;
      }).length;

      const projectsMap: Record<string, { name: string; requestCount: number; reserved: number; released: number; salesValue: number }> = {};
      for (const r of myReqs) {
        if (!projectsMap[r.projectName]) {
          projectsMap[r.projectName] = { name: r.projectName, requestCount: 0, reserved: 0, released: 0, salesValue: 0 };
        }
        projectsMap[r.projectName].requestCount++;
        const reqReserved = r.items.reduce((s, i) => s + i.quantityRequested, 0);
        const reqReleased = r.items.reduce((s, i) => s + i.quantityReleased, 0);
        const reqSalesValue = r.items.reduce((s, i) => s + (i.quantityRequested * Number(i.sellingPrice || 0)), 0);
        
        projectsMap[r.projectName].reserved += reqReserved;
        projectsMap[r.projectName].released += reqReleased;
        projectsMap[r.projectName].salesValue += reqSalesValue;
      }

      res.json({
        summary: {
          totalReserved,
          totalReleased,
          totalFrozen,
          totalSalesValue,
          expiringSoonCount,
        },
        projects: Object.values(projectsMap),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/executive-overview", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo } = req.query;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allApprovals = await db.select().from(approvals);
      const allBranches = await db.select().from(branches);

      const branchMap: Record<number, string> = {};
      for (const b of allBranches) branchMap[b.id] = b.name;

      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) {
        if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = [];
        itemsByReqId[item.requestId].push(item);
      }

      let filteredReqs = allReqs.map(r => ({
        ...r,
        items: itemsByReqId[r.id] || [],
      }));

      if (dateFrom) {
        filteredReqs = filteredReqs.filter(r => r.requestDate >= (dateFrom as string));
      }
      if (dateTo) {
        filteredReqs = filteredReqs.filter(r => r.requestDate <= (dateTo as string));
      }

      const activeReqs = filteredReqs.filter(r => r.status !== "rejected");

      const totalReservedValue = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0), 0);

      const totalReleasedValue = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityReleased * Number(i.costPrice || 0), 0), 0);

      const totalReservedQty = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityRequested, 0), 0);
      const totalReleasedQty = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityReleased, 0), 0);
      const conversionRate = totalReservedQty > 0
        ? Math.round((totalReleasedQty / totalReservedQty) * 1000) / 10
        : 0;

      const expectedGrossProfit = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => {
          const sell = Number(i.sellingPrice || 0);
          const cost = Number(i.costPrice || 0);
          return s + (sell - cost) * i.quantityRequested;
        }, 0), 0);

      const finalApproved = activeReqs.filter(r => r.status === "final_approved");
      const frozenValue = finalApproved.reduce((sum, r) => {
        const hasUnreleased = r.items.some(i => i.quantityReleased < i.quantityRequested);
        if (!hasUnreleased) return sum;
        return sum + r.items.reduce((s, i) => {
          const remaining = i.quantityRequested - i.quantityReleased;
          return s + remaining * Number(i.costPrice || 0);
        }, 0);
      }, 0);

      const reqIds = new Set(activeReqs.map(r => r.id));
      const relevantApprovals = allApprovals.filter(a => reqIds.has(a.requestId));

      let totalApprovalHours = 0;
      let approvalCount = 0;
      for (const r of activeReqs) {
        if (r.status === "submitted") continue;
        const reqApprovals = relevantApprovals
          .filter(a => a.requestId === r.id && a.action === "approve")
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (reqApprovals.length > 0) {
          const firstApproval = reqApprovals[0];
          const diffMs = new Date(firstApproval.createdAt).getTime() - new Date(r.createdAt).getTime();
          totalApprovalHours += diffMs / (1000 * 60 * 60);
          approvalCount++;
        }
      }
      const avgApprovalTimeHours = approvalCount > 0 ? Math.round((totalApprovalHours / approvalCount) * 10) / 10 : 0;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(threeDaysLater.getDate() + 3);

      const expiringReqs = finalApproved.filter(r => {
        if (!r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        const hasUnreleased = r.items.some(i => i.quantityReleased < i.quantityRequested);
        return hasUnreleased && endDate >= today && endDate <= threeDaysLater;
      });

      const expiredReqs = finalApproved.filter(r => {
        if (!r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        const hasUnreleased = r.items.some(i => i.quantityReleased < i.quantityRequested);
        return hasUnreleased && endDate < today;
      });

      const skuMap: Record<string, { reserved: number; available: number }> = {};
      for (const r of activeReqs) {
        for (const item of r.items) {
          const unreleased = Math.max(0, item.quantityRequested - item.quantityReleased);
          if (!skuMap[item.itemCode]) skuMap[item.itemCode] = { reserved: 0, available: Number(item.sellingPrice || 0) };
          skuMap[item.itemCode].reserved += unreleased;
        }
      }
      const highRiskCount = Object.values(skuMap).filter(s => s.available > 0 && (s.reserved / s.available) * 100 > 70).length;

      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const trendData: { date: string; reserved: number; released: number }[] = [];
      for (let d = new Date(thirtyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const dayReqs = activeReqs.filter(r => r.requestDate === dateStr);
        trendData.push({
          date: dateStr,
          reserved: dayReqs.reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0), 0),
          released: dayReqs.reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.quantityReleased * Number(i.costPrice || 0), 0), 0),
        });
      }

      const branchValues: Record<string, number> = {};
      for (const r of activeReqs) {
        const bName = branchMap[r.branchId] || "Unknown";
        if (!branchValues[bName]) branchValues[bName] = 0;
        branchValues[bName] += r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0);
      }
      const reservedByBranch = Object.entries(branchValues)
        .map(([name, value]) => ({ name, value: Math.round(value) }))
        .sort((a, b) => b.value - a.value);

      const allUsersData = await storage.getUsers();
      const alertItems = [...expiringReqs, ...expiredReqs].map(r => {
        const endDate = r.reservationEndDate ? new Date(r.reservationEndDate) : null;
        const daysRemaining = endDate ? Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const reservedValue = r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0);
        let riskLevel = "low";
        if (daysRemaining < 0) riskLevel = "expired";
        else if (daysRemaining <= 3) riskLevel = "high";
        return {
          requestNumber: r.requestNumber,
          branch: branchMap[r.branchId] || "Unknown",
          reservedValue: Math.round(reservedValue),
          expiryDate: r.reservationEndDate || "",
          riskLevel,
          requestId: r.id,
        };
      }).sort((a, b) => {
        const order: Record<string, number> = { expired: 0, high: 1, low: 2 };
        return (order[a.riskLevel] || 2) - (order[b.riskLevel] || 2);
      });

      res.json({
        totalReservedValue: Math.round(totalReservedValue),
        totalReleasedValue: Math.round(totalReleasedValue),
        frozenValue: Math.round(frozenValue),
        expectedGrossProfit: Math.round(expectedGrossProfit),
        conversionRate,
        avgApprovalTimeHours,
        health: {
          expiringSoon: expiringReqs.length,
          expiredReservations: expiredReqs.length,
          highRiskReservations: highRiskCount,
        },
        trendData,
        reservedByBranch,
        alertItems,
      });
    } catch (err: any) {
      console.error("[Executive Overview Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/planning-reports", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo, warehouse, brand, salesRepId, department } = req.query;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allUsersData = await storage.getUsers();
      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) {
        if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = [];
        itemsByReqId[item.requestId].push(item);
      }

      let filteredReqs = allReqs.map(r => ({
        ...r,
        items: itemsByReqId[r.id] || [],
        creator: allUsersData.find((u: any) => u.id === r.createdBy),
        salesRep: allUsersData.find((u: any) => u.id === r.salesRepId),
      }));

      if (dateFrom) {
        filteredReqs = filteredReqs.filter(r => r.requestDate >= (dateFrom as string));
      }
      if (dateTo) {
        filteredReqs = filteredReqs.filter(r => r.requestDate <= (dateTo as string));
      }
      if (warehouse) {
        filteredReqs = filteredReqs.filter(r => r.items.some(i => i.warehouse === warehouse));
      }
      if (brand) {
        filteredReqs = filteredReqs.filter(r => r.items.some(i => i.brand === brand));
      }
      if (salesRepId) {
        filteredReqs = filteredReqs.filter(r => r.salesRepId === parseInt(salesRepId as string));
      }
      if (department) {
        filteredReqs = filteredReqs.filter(r => r.department === department);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const activeReqs = filteredReqs.filter(r => r.status !== "rejected");
      const finalApproved = filteredReqs.filter(r => r.status === "final_approved");

      const totalReservedQty = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityRequested, 0), 0);
      const totalReleasedQty = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityReleased, 0), 0);

      const utilizationPercent = totalReservedQty > 0
        ? Math.round((totalReleasedQty / totalReservedQty) * 100)
        : 0;

      const expiredReqs = finalApproved.filter(r => {
        if (!r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        return endDate < today;
      });
      const expiredCount = expiredReqs.length;
      const expiredReservedQty = expiredReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + (i.quantityRequested - i.quantityReleased), 0), 0);

      const releasedReqs = filteredReqs.filter(r =>
        r.items.some(i => i.quantityReleased > 0));
      const releaseRate = filteredReqs.length > 0
        ? Math.round((releasedReqs.length / filteredReqs.length) * 100)
        : 0;

      const durations = filteredReqs
        .filter(r => r.reservationDuration)
        .map(r => parseInt(r.reservationDuration || "0"));
      const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const volumeOverTime: { date: string; count: number; reserved: number }[] = [];
      for (let d = new Date(thirtyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const dayReqs = filteredReqs.filter(r => r.requestDate === dateStr);
        volumeOverTime.push({
          date: dateStr,
          count: dayReqs.length,
          reserved: dayReqs.reduce((sum, r) =>
            sum + r.items.reduce((s, i) => s + i.quantityRequested, 0), 0),
        });
      }

      const warehouseMap: Record<string, { count: number; reserved: number }> = {};
      for (const r of activeReqs) {
        for (const item of r.items) {
          if (!warehouseMap[item.warehouse]) warehouseMap[item.warehouse] = { count: 0, reserved: 0 };
          warehouseMap[item.warehouse].count++;
          warehouseMap[item.warehouse].reserved += item.quantityRequested;
        }
      }
      const reservationsByWarehouse = Object.entries(warehouseMap).map(([name, data]) => ({
        warehouse: name,
        count: data.count,
        reserved: data.reserved,
      }));

      let upTo15 = 0, from16to30 = 0, over30 = 0;
      for (const r of filteredReqs) {
        const dur = parseInt(r.reservationDuration || "0");
        if (dur <= 15) upTo15++;
        else if (dur <= 30) from16to30++;
        else over30++;
      }
      const durationSplit = [
        { name: "≤15", value: upTo15 },
        { name: "16-30", value: from16to30 },
        { name: ">30", value: over30 },
      ];

      const skuMap: Record<string, { code: string; description: string; brand: string; reserved: number; released: number; durations: number[] }> = {};
      for (const r of activeReqs) {
        const dur = parseInt(r.reservationDuration || "0");
        for (const item of r.items) {
          const key = item.itemCode;
          if (!skuMap[key]) skuMap[key] = { code: item.itemCode, description: item.itemDescription, brand: item.brand, reserved: 0, released: 0, durations: [] };
          skuMap[key].reserved += item.quantityRequested;
          skuMap[key].released += item.quantityReleased;
          skuMap[key].durations.push(dur);
        }
      }
      const highRiskSKUs = Object.values(skuMap)
        .map(s => {
          const unreleased = Math.max(s.reserved - s.released, 0);
          const utilization = s.reserved > 0 ? Math.round((s.released / s.reserved) * 100) : 0;
          const avgDur = s.durations.length > 0 ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length) : 0;
          return {
            skuCode: s.code,
            description: s.description,
            brand: s.brand,
            reservedQty: s.reserved,
            availableQty: unreleased,
            utilization,
            avgDuration: avgDur,
          };
        })
        .filter(s => s.utilization > 70 || s.avgDuration > 30)
        .sort((a, b) => b.utilization - a.utilization);

      const policyViolations = filteredReqs
        .filter(r => {
          const dur = parseInt(r.reservationDuration || "0");
          const hasPaymentPath = !!r.advancePayment && !!r.accountStatementFile;
          const hasPOPath = !!r.purchaseOrderFile;
          return dur > 15 && !hasPaymentPath && !hasPOPath;
        })
        .map(r => ({
          requestId: r.requestNumber,
          requestDbId: r.id,
          salesRep: r.salesRep?.name || r.creator?.name || "Unknown",
          duration: parseInt(r.reservationDuration || "0"),
          advancePayment: r.advancePayment ? parseFloat(r.advancePayment) : null,
          poAttached: !!r.purchaseOrderFile,
          warehouse: Array.from(new Set(r.items.map(i => i.warehouse))).join(", "),
          status: r.status,
        }));

      const sevenDaysFromNow = new Date(today);
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
      const expiringSoon = finalApproved
        .filter(r => {
          if (!r.reservationEndDate) return false;
          const endDate = new Date(r.reservationEndDate);
          endDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays >= 0 && diffDays <= 7;
        })
        .map(r => {
          const endDate = new Date(r.reservationEndDate!);
          endDate.setHours(0, 0, 0, 0);
          const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return {
            requestId: r.requestNumber,
            requestDbId: r.id,
            projectName: r.projectName,
            salesRep: r.salesRep?.name || r.creator?.name || "Unknown",
            skuCount: r.items.length,
            totalReserved: r.items.reduce((s, i) => s + i.quantityRequested, 0),
            daysRemaining,
          };
        })
        .sort((a, b) => a.daysRemaining - b.daysRemaining);

      const allWarehouseNames = Array.from(new Set(allItems.map(i => i.warehouse))).sort();
      const allBrandNames = Array.from(new Set(allItems.map(i => i.brand))).sort();
      const allDepartmentNames = Array.from(new Set(allReqs.map(r => r.department))).sort();
      const salesReps = allUsersData.filter((u: any) => u.role === "sales_rep").map((u: any) => ({ id: u.id, name: u.name }));

      res.json({
        kpis: {
          totalReservedQty,
          utilizationPercent,
          expiredCount,
          expiredReservedQty,
          releaseRate,
          avgDuration,
        },
        volumeOverTime,
        reservationsByWarehouse,
        durationSplit,
        highRiskSKUs,
        policyViolations,
        expiringSoon,
        filterOptions: {
          warehouses: allWarehouseNames,
          brands: allBrandNames,
          departments: allDepartmentNames,
          salesReps,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/inventory-risk", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const allReqs = await db.select().from(requests).where(
        and(
          ne(requests.status, "rejected"),
          ne(requests.status, "submitted")
        )
      );
      const allItems = await db.select().from(requestItems);
      const allBranches = await storage.getBranches();
      const branchMap: Record<number, string> = {};
      for (const b of allBranches) branchMap[b.id] = b.name;

      const reqIds = new Set(allReqs.map(r => r.id));
      const filteredItems = allItems.filter(i => reqIds.has(i.requestId));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(today.getDate() + 3);

      const productAggregation: Record<string, {
        code: string;
        desc: string;
        reserved: number;
        available: number;
        expiringSoon: boolean;
        expired: boolean;
        minDaysToExpiry: number | null;
        branches: Set<string>;
        warehouses: Set<string>;
        categories: Set<string>;
      }> = {};

      for (const item of filteredItems) {
        const req = allReqs.find(r => r.id === item.requestId)!;
        const unreleased = Math.max(0, item.quantityRequested - (item.quantityReleased || 0));
        if (unreleased === 0) continue;

        if (!productAggregation[item.itemCode]) {
          productAggregation[item.itemCode] = {
            code: item.itemCode,
            desc: item.itemDescription,
            reserved: 0,
            available: Math.max(0, Math.round(Number(item.sellingPrice || 0))),
            expiringSoon: false,
            expired: false,
            minDaysToExpiry: null,
            branches: new Set(),
            warehouses: new Set(),
            categories: new Set(),
          };
        }
        productAggregation[item.itemCode].reserved += unreleased;
        productAggregation[item.itemCode].branches.add(branchMap[req.branchId] || "Unknown");
        if (item.warehouse) productAggregation[item.itemCode].warehouses.add(item.warehouse);
        if (req.department) productAggregation[item.itemCode].categories.add(req.department);

        if (req.reservationEndDate) {
          const endDate = new Date(req.reservationEndDate);
          endDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (productAggregation[item.itemCode].minDaysToExpiry === null || diffDays < productAggregation[item.itemCode].minDaysToExpiry!) {
            productAggregation[item.itemCode].minDaysToExpiry = diffDays;
          }
          if (diffDays < 0) productAggregation[item.itemCode].expired = true;
          else if (diffDays <= 3) productAggregation[item.itemCode].expiringSoon = true;
        }
      }

      const products = Object.values(productAggregation).map(p => {
        const ratio = p.available > 0 ? (p.reserved / p.available) * 100 : (p.reserved > 0 ? 100 : 0);

        let riskScore = 0;
        if (ratio > 100) riskScore += 40;
        else if (ratio > 70) riskScore += 30;
        if (p.available === 0 && p.reserved > 0) riskScore += 20;
        if (p.expired) riskScore += 30;
        else if (p.expiringSoon) riskScore += 20;
        riskScore = Math.min(100, riskScore);

        let riskLevel = "Low";
        if (riskScore >= 50) riskLevel = "High";
        else if (riskScore >= 30) riskLevel = "Medium";

        return {
          code: p.code,
          desc: p.desc,
          reserved: p.reserved,
          available: p.available,
          reservedRatio: Math.round(ratio),
          daysToExpiry: p.minDaysToExpiry,
          riskScore,
          riskLevel,
          expired: p.expired,
          expiringSoon: p.expiringSoon,
          branches: Array.from(p.branches),
          warehouses: Array.from(p.warehouses),
          categories: Array.from(p.categories),
        };
      }).sort((a, b) => b.riskScore - a.riskScore);

      const highRiskCount = products.filter(p => p.riskLevel === "High").length;
      const totalExpired = products.filter(p => p.expired).length;
      const totalExpiringSoon = products.filter(p => p.expiringSoon && !p.expired).length;
      const lowStockAlerts = products.filter(p => p.available === 0 && p.reserved > 0).length;

      const allBranchNames = [...new Set(products.flatMap(p => p.branches))].sort();
      const allWarehouseNames = [...new Set(products.flatMap(p => p.warehouses))].sort();
      const allCategoryNames = [...new Set(products.flatMap(p => p.categories))].sort();

      res.json({
        kpis: {
          highRiskItems: highRiskCount,
          expiredReservations: totalExpired,
          expiringSoon: totalExpiringSoon,
          lowStockAlerts,
        },
        products,
        filters: {
          branches: allBranchNames,
          warehouses: allWarehouseNames,
          categories: allCategoryNames,
        },
      });
    } catch (err: any) {
      console.error("[Inventory Risk Console Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/inventory-risk/export", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const allReqs = await db.select().from(requests).where(
        and(ne(requests.status, "rejected"), ne(requests.status, "submitted"))
      );
      const allItems = await db.select().from(requestItems);
      const allBranches = await storage.getBranches();
      const branchMap: Record<number, string> = {};
      for (const b of allBranches) branchMap[b.id] = b.name;

      const reqIds = new Set(allReqs.map(r => r.id));
      const filteredItems = allItems.filter(i => reqIds.has(i.requestId));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(today.getDate() + 3);

      const productAgg: Record<string, { code: string; desc: string; reserved: number; available: number; expired: boolean; expiringSoon: boolean; minDaysToExpiry: number | null }> = {};

      for (const item of filteredItems) {
        const req = allReqs.find(r => r.id === item.requestId)!;
        const unreleased = Math.max(0, item.quantityRequested - (item.quantityReleased || 0));
        if (unreleased === 0) continue;
        if (!productAgg[item.itemCode]) {
          productAgg[item.itemCode] = { code: item.itemCode, desc: item.itemDescription, reserved: 0, available: Math.max(0, Math.round(Number(item.sellingPrice || 0))), expired: false, expiringSoon: false, minDaysToExpiry: null };
        }
        productAgg[item.itemCode].reserved += unreleased;
        if (req.reservationEndDate) {
          const endDate = new Date(req.reservationEndDate); endDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (productAgg[item.itemCode].minDaysToExpiry === null || diffDays < productAgg[item.itemCode].minDaysToExpiry!) productAgg[item.itemCode].minDaysToExpiry = diffDays;
          if (diffDays < 0) productAgg[item.itemCode].expired = true;
          else if (diffDays <= 3) productAgg[item.itemCode].expiringSoon = true;
        }
      }

      const products = Object.values(productAgg).map(p => {
        const ratio = p.available > 0 ? (p.reserved / p.available) * 100 : (p.reserved > 0 ? 100 : 0);
        let riskScore = 0;
        if (ratio > 100) riskScore += 40; else if (ratio > 70) riskScore += 30;
        if (p.available === 0 && p.reserved > 0) riskScore += 20;
        if (p.expired) riskScore += 30; else if (p.expiringSoon) riskScore += 20;
        riskScore = Math.min(100, riskScore);
        return { ...p, reservedRatio: Math.round(ratio), riskScore, riskLevel: riskScore >= 50 ? "High" : riskScore >= 30 ? "Medium" : "Low" };
      }).sort((a, b) => b.riskScore - a.riskScore);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "BaytAlebaa Inventory System";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Risk_Console");

      sheet.addRow(["Inventory Risk Console - BaytAlebaa"]);
      sheet.mergeCells("A1:H1");
      const titleCell = sheet.getCell("A1");
      titleCell.font = { bold: true, size: 16, color: { argb: "FF1A5276" } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 30;

      const highRisk = products.filter(p => p.riskLevel === "High").length;
      const expired = products.filter(p => p.expired).length;
      const expSoon = products.filter(p => p.expiringSoon && !p.expired).length;
      sheet.addRow([]);
      sheet.addRow(["High Risk Items:", highRisk, "", "Expired:", expired, "", "Expiring Soon:", expSoon]);
      sheet.addRow(["Export Date:", new Date().toISOString().split("T")[0]]);
      sheet.addRow([]);

      const headers = ["Product Code", "Description", "Reserved Qty", "Available Qty", "Reserved Ratio %", "Days to Expiry", "Risk Score", "Risk Level"];
      const headerRow = sheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A5276" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      });
      headerRow.height = 25;

      for (const p of products) {
        const row = sheet.addRow([
          p.code, p.desc, p.reserved, p.available,
          `${p.reservedRatio}%`, p.minDaysToExpiry !== null ? p.minDaysToExpiry : "N/A",
          p.riskScore, p.riskLevel,
        ]);
        if (p.riskLevel === "High") {
          row.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };
          });
        }
        row.eachCell((cell) => {
          cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
        });
      }

      [12, 35, 12, 12, 14, 14, 12, 12].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=Risk_Console.xlsx");
      await workbook.xlsx.write(res);
      res.end();
    } catch (err: any) {
      console.error("[Risk Console Export Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/performance", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { branch, dateFrom, dateTo, salesRepId: qRepId, activeOnly } = req.query;
      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allApprovals = await db.select().from(approvals);
      const allUsersData = await storage.getUsers();
      const allBranches = await db.select().from(branches);

      const branchMap: Record<number, string> = {};
      for (const b of allBranches) branchMap[b.id] = b.name;

      const userMap: Record<number, { name: string; role: string; branchId: number | null }> = {};
      for (const u of allUsersData) userMap[u.id] = { name: u.name, role: u.role, branchId: u.branchId };

      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) {
        if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = [];
        itemsByReqId[item.requestId].push(item);
      }

      let filteredReqs = allReqs;
      if (branch && typeof branch === "string") {
        const branchId = allBranches.find(b => b.name === branch)?.id;
        if (branchId) filteredReqs = filteredReqs.filter(r => r.branchId === branchId);
      }
      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);
      if (qRepId && typeof qRepId === "string") {
        const rid = parseInt(qRepId);
        filteredReqs = filteredReqs.filter(r => r.salesRepId === rid || r.createdBy === rid);
      }

      const salesReps = allUsersData.filter(u => u.role === "sales_rep");

      const repStats: Record<number, {
        name: string;
        totalOrders: number;
        approvedOrders: number;
        rejectedOrders: number;
        expectedRevenue: number;
        actualRevenue: number;
        expectedProfit: number;
        actualProfit: number;
        branch: string;
        totalApprovalTimeMs: number;
        approvalCount: number;
      }> = {};

      for (const rep of salesReps) {
        repStats[rep.id] = {
          name: rep.name,
          totalOrders: 0,
          approvedOrders: 0,
          rejectedOrders: 0,
          expectedRevenue: 0,
          actualRevenue: 0,
          expectedProfit: 0,
          actualProfit: 0,
          branch: rep.branchId ? (branchMap[rep.branchId] || "N/A") : "N/A",
          totalApprovalTimeMs: 0,
          approvalCount: 0,
        };
      }

      for (const req of filteredReqs) {
        const repId = req.salesRepId || req.createdBy;
        if (!repStats[repId]) {
          const u = userMap[repId];
          if (!u || u.role !== "sales_rep") continue;
          repStats[repId] = {
            name: u.name, totalOrders: 0, approvedOrders: 0, rejectedOrders: 0,
            expectedRevenue: 0, actualRevenue: 0, expectedProfit: 0, actualProfit: 0,
            branch: u.branchId ? (branchMap[u.branchId] || "N/A") : "N/A",
            totalApprovalTimeMs: 0, approvalCount: 0,
          };
        }
        repStats[repId].totalOrders++;
        if (req.status === "rejected") repStats[repId].rejectedOrders++;
        const isApproved = ["branch_approved", "category_approved", "final_approved", "closed"].includes(req.status);
        if (isApproved) repStats[repId].approvedOrders++;

        const items = itemsByReqId[req.id] || [];
        for (const item of items) {
          const selling = Number(item.sellingPrice || 0);
          const cost = Number(item.costPrice || 0);
          repStats[repId].expectedRevenue += selling * item.quantityRequested;
          repStats[repId].actualRevenue += selling * (item.quantityReleased || 0);
          repStats[repId].expectedProfit += (selling - cost) * item.quantityRequested;
          repStats[repId].actualProfit += (selling - cost) * (item.quantityReleased || 0);
        }
      }

      for (const appr of allApprovals) {
        if (appr.action === "approve") {
          const req = allReqs.find(r => r.id === appr.requestId);
          if (!req) continue;
          const repId = req.salesRepId || req.createdBy;
          if (!repStats[repId]) continue;
          const submitTime = req.createdAt ? new Date(req.createdAt).getTime() : 0;
          const approveTime = appr.createdAt ? new Date(appr.createdAt).getTime() : 0;
          if (submitTime && approveTime && approveTime > submitTime) {
            repStats[repId].totalApprovalTimeMs += (approveTime - submitTime);
            repStats[repId].approvalCount++;
          }
        }
      }

      let repArray = Object.entries(repStats)
        .map(([id, s]) => {
          const rejectionRate = s.totalOrders > 0 ? Math.round((s.rejectedOrders / s.totalOrders) * 100) : 0;
          const conversionRate = s.totalOrders > 0 ? Math.round((s.approvedOrders / s.totalOrders) * 100) : 0;
          const profitMargin = s.expectedRevenue > 0 ? Math.round((s.expectedProfit / s.expectedRevenue) * 100) : 0;
          const avgApprovalHours = s.approvalCount > 0 ? Math.round((s.totalApprovalTimeMs / s.approvalCount / (1000 * 60 * 60)) * 10) / 10 : 0;
          return {
            id: Number(id), name: s.name, branch: s.branch,
            totalOrders: s.totalOrders, approvedOrders: s.approvedOrders, rejectedOrders: s.rejectedOrders,
            rejectionRate, conversionRate, profitMargin, avgApprovalHours,
            expectedRevenue: Math.round(s.expectedRevenue), actualRevenue: Math.round(s.actualRevenue),
            expectedProfit: Math.round(s.expectedProfit), actualProfit: Math.round(s.actualProfit),
          };
        })
        .filter(r => r.totalOrders > 0)
        .sort((a, b) => b.actualProfit - a.actualProfit);

      if (activeOnly === "true") repArray = repArray.filter(r => r.totalOrders >= 1);

      const totalOrders = repArray.reduce((s, r) => s + r.totalOrders, 0);
      const totalRejected = repArray.reduce((s, r) => s + r.rejectedOrders, 0);
      const totalApproved = repArray.reduce((s, r) => s + r.approvedOrders, 0);
      const totalExpRevenue = repArray.reduce((s, r) => s + r.expectedRevenue, 0);
      const totalActRevenue = repArray.reduce((s, r) => s + r.actualRevenue, 0);
      const totalExpProfit = repArray.reduce((s, r) => s + r.expectedProfit, 0);
      const totalActProfit = repArray.reduce((s, r) => s + r.actualProfit, 0);
      const overallRejRate = totalOrders > 0 ? Math.round((totalRejected / totalOrders) * 100) : 0;
      const overallConversion = totalOrders > 0 ? Math.round((totalApproved / totalOrders) * 100) : 0;
      const overallMargin = totalExpRevenue > 0 ? Math.round((totalExpProfit / totalExpRevenue) * 100) : 0;
      const allApprovalTimes = repArray.filter(r => r.avgApprovalHours > 0);
      const avgApprovalOverall = allApprovalTimes.length > 0
        ? Math.round((allApprovalTimes.reduce((s, r) => s + r.avgApprovalHours, 0) / allApprovalTimes.length) * 10) / 10 : 0;

      const approvalTrend: { date: string; avgHours: number }[] = [];
      const approvalsByDate: Record<string, { totalMs: number; count: number }> = {};
      for (const appr of allApprovals) {
        if (appr.action !== "approve") continue;
        const req = allReqs.find(r => r.id === appr.requestId);
        if (!req) continue;
        const dt = req.requestDate;
        const submitTime = req.createdAt ? new Date(req.createdAt).getTime() : 0;
        const approveTime = appr.createdAt ? new Date(appr.createdAt).getTime() : 0;
        if (submitTime && approveTime && approveTime > submitTime) {
          if (!approvalsByDate[dt]) approvalsByDate[dt] = { totalMs: 0, count: 0 };
          approvalsByDate[dt].totalMs += (approveTime - submitTime);
          approvalsByDate[dt].count++;
        }
      }
      for (const [date, d] of Object.entries(approvalsByDate).sort(([a], [b]) => a.localeCompare(b))) {
        approvalTrend.push({ date, avgHours: Math.round((d.totalMs / d.count / (1000 * 60 * 60)) * 10) / 10 });
      }

      const topPerformer = repArray.length > 0 ? repArray[0] : null;
      const slowestApprover = repArray.filter(r => r.avgApprovalHours > 0).sort((a, b) => b.avgApprovalHours - a.avgApprovalHours)[0] || null;
      const highestRejRisk = repArray.filter(r => r.totalOrders >= 2).sort((a, b) => b.rejectionRate - a.rejectionRate)[0] || null;
      const mostProfitable = repArray.sort((a, b) => b.profitMargin - a.profitMargin)[0] || null;

      const salesRepOptions = salesReps
        .filter(r => repStats[r.id]?.totalOrders > 0)
        .map(r => ({ id: r.id, name: r.name }));

      res.json({
        kpis: {
          actualRevenue: totalActRevenue,
          expectedRevenue: totalExpRevenue,
          avgApprovalTimeHours: avgApprovalOverall,
          rejectionRate: overallRejRate,
          profitMargin: overallMargin,
          conversionRate: overallConversion,
        },
        repRanking: repArray.map((r, i) => ({ rank: i + 1, ...r })),
        approvalTrend,
        statusSplit: { approved: totalApproved, rejected: totalRejected, pending: totalOrders - totalApproved - totalRejected },
        insights: {
          topPerformer: topPerformer ? { name: topPerformer.name, actualProfit: topPerformer.actualProfit } : null,
          slowestApprover: slowestApprover ? { name: slowestApprover.name, avgHours: slowestApprover.avgApprovalHours } : null,
          highestRejRisk: highestRejRisk ? { name: highestRejRisk.name, rate: highestRejRisk.rejectionRate } : null,
          mostProfitable: mostProfitable ? { name: mostProfitable.name, margin: mostProfitable.profitMargin } : null,
        },
        filters: {
          branches: allBranches.map(b => b.name),
          salesReps: salesRepOptions,
        },
      });
    } catch (err: any) {
      console.error("[Performance Report Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/performance/export", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { branch, dateFrom, dateTo, salesRepId: qRepId } = req.query;
      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allApprovals = await db.select().from(approvals);
      const allUsersData = await storage.getUsers();
      const allBranches = await db.select().from(branches);
      const branchMap: Record<number, string> = {};
      for (const b of allBranches) branchMap[b.id] = b.name;
      const userMap: Record<number, { name: string; role: string; branchId: number | null }> = {};
      for (const u of allUsersData) userMap[u.id] = { name: u.name, role: u.role, branchId: u.branchId };
      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) { if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = []; itemsByReqId[item.requestId].push(item); }

      let filteredReqs = allReqs;
      if (branch && typeof branch === "string") { const bid = allBranches.find(b => b.name === branch)?.id; if (bid) filteredReqs = filteredReqs.filter(r => r.branchId === bid); }
      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);
      if (qRepId && typeof qRepId === "string") { const rid = parseInt(qRepId); filteredReqs = filteredReqs.filter(r => r.salesRepId === rid || r.createdBy === rid); }

      const salesReps = allUsersData.filter(u => u.role === "sales_rep");
      const repStats: Record<number, { name: string; branch: string; totalOrders: number; approvedOrders: number; rejectedOrders: number; expectedProfit: number; actualProfit: number; expectedRevenue: number; actualRevenue: number; totalApprovalTimeMs: number; approvalCount: number }> = {};
      for (const rep of salesReps) { repStats[rep.id] = { name: rep.name, branch: rep.branchId ? (branchMap[rep.branchId] || "N/A") : "N/A", totalOrders: 0, approvedOrders: 0, rejectedOrders: 0, expectedProfit: 0, actualProfit: 0, expectedRevenue: 0, actualRevenue: 0, totalApprovalTimeMs: 0, approvalCount: 0 }; }
      for (const req of filteredReqs) {
        const repId = req.salesRepId || req.createdBy;
        if (!repStats[repId]) { const u = userMap[repId]; if (!u || u.role !== "sales_rep") continue; repStats[repId] = { name: u.name, branch: u.branchId ? (branchMap[u.branchId] || "N/A") : "N/A", totalOrders: 0, approvedOrders: 0, rejectedOrders: 0, expectedProfit: 0, actualProfit: 0, expectedRevenue: 0, actualRevenue: 0, totalApprovalTimeMs: 0, approvalCount: 0 }; }
        repStats[repId].totalOrders++;
        if (req.status === "rejected") repStats[repId].rejectedOrders++;
        if (["branch_approved", "category_approved", "final_approved", "closed"].includes(req.status)) repStats[repId].approvedOrders++;
        const items = itemsByReqId[req.id] || [];
        for (const item of items) { const s = Number(item.sellingPrice || 0); const c = Number(item.costPrice || 0); repStats[repId].expectedRevenue += s * item.quantityRequested; repStats[repId].actualRevenue += s * (item.quantityReleased || 0); repStats[repId].expectedProfit += (s - c) * item.quantityRequested; repStats[repId].actualProfit += (s - c) * (item.quantityReleased || 0); }
      }
      for (const appr of allApprovals) { if (appr.action === "approve") { const req = allReqs.find(r => r.id === appr.requestId); if (!req) continue; const repId = req.salesRepId || req.createdBy; if (!repStats[repId]) continue; const st = req.createdAt ? new Date(req.createdAt).getTime() : 0; const at = appr.createdAt ? new Date(appr.createdAt).getTime() : 0; if (st && at && at > st) { repStats[repId].totalApprovalTimeMs += (at - st); repStats[repId].approvalCount++; } } }

      const repArray = Object.values(repStats).filter(r => r.totalOrders > 0).map(r => ({
        ...r,
        rejectionRate: r.totalOrders > 0 ? Math.round((r.rejectedOrders / r.totalOrders) * 100) : 0,
        conversionRate: r.totalOrders > 0 ? Math.round((r.approvedOrders / r.totalOrders) * 100) : 0,
        profitMargin: r.expectedRevenue > 0 ? Math.round((r.expectedProfit / r.expectedRevenue) * 100) : 0,
        avgApprovalHours: r.approvalCount > 0 ? Math.round((r.totalApprovalTimeMs / r.approvalCount / (1000 * 60 * 60)) * 10) / 10 : 0,
      })).sort((a, b) => b.actualProfit - a.actualProfit);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "BaytAlebaa Inventory System";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Sales_Performance");

      sheet.addRow(["Sales Performance Dashboard - BaytAlebaa"]);
      sheet.mergeCells("A1:J1");
      sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF1A5276" } };
      sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 30;
      sheet.addRow(["Export Date:", new Date().toISOString().split("T")[0]]);
      sheet.addRow([]);

      const headers = ["Rank", "Sales Rep", "Branch", "Total Orders", "Approved", "Rejected", "Avg Approval (hrs)", "Expected Profit", "Actual Profit", "Profit Margin %", "Conversion %"];
      const headerRow = sheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A5276" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      });
      headerRow.height = 25;

      repArray.forEach((r, i) => {
        const row = sheet.addRow([i + 1, r.name, r.branch, r.totalOrders, r.approvedOrders, r.rejectedOrders, r.avgApprovalHours, Math.round(r.expectedProfit), Math.round(r.actualProfit), `${r.profitMargin}%`, `${r.conversionRate}%`]);
        if (i < 3) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } }; });
        row.eachCell((cell) => { cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } }; });
      });

      [6, 18, 14, 12, 12, 10, 16, 14, 14, 13, 13].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=Sales_Performance.xlsx");
      await workbook.xlsx.write(res);
      res.end();
    } catch (err: any) {
      console.error("[Performance Export Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/planning/export", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo, warehouse, brand, salesRepId, department } = req.query;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allUsersData = await storage.getUsers();
      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) {
        if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = [];
        itemsByReqId[item.requestId].push(item);
      }

      const planningWarehouses = await db.select().from(adminWarehouses);
      const planningWarehouseLocationMap: Record<string, string> = {};
      for (const wh of planningWarehouses) {
        planningWarehouseLocationMap[wh.name] = wh.location || "";
      }

      let filteredReqs = allReqs.map(r => ({
        ...r,
        items: itemsByReqId[r.id] || [],
        creator: allUsersData.find((u: any) => u.id === r.createdBy),
        salesRep: allUsersData.find((u: any) => u.id === r.salesRepId),
      }));

      if (dateFrom) filteredReqs = filteredReqs.filter(r => r.requestDate >= (dateFrom as string));
      if (dateTo) filteredReqs = filteredReqs.filter(r => r.requestDate <= (dateTo as string));
      if (warehouse) filteredReqs = filteredReqs.filter(r => r.items.some(i => i.warehouse === warehouse));
      if (brand) filteredReqs = filteredReqs.filter(r => r.items.some(i => i.brand === brand));
      if (salesRepId) filteredReqs = filteredReqs.filter(r => r.salesRepId === parseInt(salesRepId as string));
      if (department) filteredReqs = filteredReqs.filter(r => r.department === department);

      const activeReqs = filteredReqs.filter(r => r.status !== "rejected");
      const totalReservedQty = activeReqs.reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.quantityRequested, 0), 0);
      const totalReleasedQty = activeReqs.reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.quantityReleased, 0), 0);
      const utilizationPercent = totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0;

      const filterParts: string[] = [];
      if (dateFrom) filterParts.push(`From: ${dateFrom}`);
      if (dateTo) filterParts.push(`To: ${dateTo}`);
      if (warehouse) filterParts.push(`Warehouse: ${warehouse}`);
      if (brand) filterParts.push(`Brand: ${brand}`);
      if (salesRepId) {
        const rep = allUsersData.find((u: any) => u.id === parseInt(salesRepId as string));
        filterParts.push(`Sales Rep: ${rep?.name || salesRepId}`);
      }
      if (department) filterParts.push(`Department: ${department}`);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "BaytAlebaa Inventory System";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Planning_Report");

      sheet.addRow(["Planning Report - BaytAlebaa Inventory System"]);
      sheet.mergeCells("A1:T1");
      const titleCell = sheet.getCell("A1");
      titleCell.font = { bold: true, size: 16, color: { argb: "FF1A5276" } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 30;

      sheet.addRow([]);
      sheet.addRow(["Total Requests:", filteredReqs.length, "", "Total Reserved Qty:", totalReservedQty, "", "Total Released Qty:", totalReleasedQty]);
      sheet.addRow(["Utilization %:", `${utilizationPercent}%`, "", "Export Date:", new Date().toISOString().split("T")[0], "", "Filtered By:", filterParts.length > 0 ? filterParts.join("; ") : "No filters"]);

      const summaryRows = [3, 4];
      for (const rowNum of summaryRows) {
        const row = sheet.getRow(rowNum);
        row.eachCell((cell, colNumber) => {
          if (colNumber % 3 === 1) {
            cell.font = { bold: true, size: 11, color: { argb: "FF2C3E50" } };
          } else {
            cell.font = { size: 11 };
          }
        });
      }

      sheet.addRow([]);

      const headers = [
        "Request ID", "Request Date", "End Date", "Project Name", "Department",
        "Sales Rep", "Warehouse", "Warehouse Location", "Brand", "SKU Code", "Product Description",
        "Reserved Quantity", "Released Quantity", "Remaining Quantity",
        "Reservation Duration (Days)", "Advance Payment", "PO Attached",
        "Account Statement", "Status", "Created At"
      ];
      const headerRow = sheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A5276" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin" }, bottom: { style: "thin" },
          left: { style: "thin" }, right: { style: "thin" },
        };
      });
      headerRow.height = 25;

      const statusMap: Record<string, string> = {
        submitted: "Submitted",
        branch_approved: "Branch Approved",
        category_approved: "Category Approved",
        final_approved: "Final Approved",
        rejected: "Rejected",
      };

      let rowIndex = 0;
      for (const req of filteredReqs) {
        for (const item of req.items) {
          const remaining = item.quantityRequested - item.quantityReleased;
          const dataRow = sheet.addRow([
            req.requestNumber,
            req.requestDate,
            req.reservationEndDate || "",
            req.projectName,
            req.department,
            req.salesRep?.name || req.creator?.name || "",
            item.warehouse,
            planningWarehouseLocationMap[item.warehouse] || "",
            item.brand,
            item.itemCode,
            item.itemDescription,
            item.quantityRequested,
            item.quantityReleased,
            remaining,
            req.reservationDuration ? parseInt(req.reservationDuration) : "",
            req.advancePayment ? parseFloat(req.advancePayment) : 0,
            req.purchaseOrderFile ? "Yes" : "No",
            req.accountStatementFile ? "Yes" : "No",
            statusMap[req.status] || req.status,
            req.createdAt ? new Date(req.createdAt).toISOString().split("T")[0] : "",
          ]);

          dataRow.eachCell((cell) => {
            cell.border = {
              top: { style: "thin", color: { argb: "FFD5D8DC" } },
              bottom: { style: "thin", color: { argb: "FFD5D8DC" } },
              left: { style: "thin", color: { argb: "FFD5D8DC" } },
              right: { style: "thin", color: { argb: "FFD5D8DC" } },
            };
            cell.alignment = { vertical: "middle" };
          });

          if (rowIndex % 2 === 1) {
            dataRow.eachCell((cell) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F4" } };
            });
          }
          rowIndex++;
        }
      }

      sheet.columns = [
        { width: 14 }, { width: 13 }, { width: 13 }, { width: 22 }, { width: 16 },
        { width: 18 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 16 }, { width: 28 },
        { width: 14 }, { width: 14 }, { width: 14 },
        { width: 14 }, { width: 14 }, { width: 12 },
        { width: 16 }, { width: 16 }, { width: 13 },
      ];

      sheet.views = [{ state: "frozen", ySplit: 6, xSplit: 0 }];

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=Planning_Report_${new Date().toISOString().split("T")[0]}.xlsx`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("[Excel Export Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/financial-exposure", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo } = req.query;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allBranches = await db.select().from(branches);

      const branchMap: Record<number, string> = {};
      for (const b of allBranches) branchMap[b.id] = b.name;

      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) {
        if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = [];
        itemsByReqId[item.requestId].push(item);
      }

      let enrichedReqs = allReqs.map(r => ({
        ...r,
        items: itemsByReqId[r.id] || [],
        branchName: branchMap[r.branchId] || `Branch ${r.branchId}`,
      }));

      if (dateFrom) enrichedReqs = enrichedReqs.filter(r => r.requestDate >= (dateFrom as string));
      if (dateTo) enrichedReqs = enrichedReqs.filter(r => r.requestDate <= (dateTo as string));

      const activeReqs = enrichedReqs.filter(r => r.status !== "rejected");

      const totalReservedValue = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0), 0);

      const finalApproved = activeReqs.filter(r => r.status === "final_approved");
      const frozenValue = finalApproved.reduce((sum, r) => {
        const hasUnreleased = r.items.some(i => i.quantityReleased < i.quantityRequested);
        if (!hasUnreleased) return sum;
        return sum + r.items.reduce((s, i) => {
          const remaining = i.quantityRequested - i.quantityReleased;
          return s + remaining * Number(i.costPrice || 0);
        }, 0);
      }, 0);

      const expectedGrossProfit = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => {
          const sell = Number(i.sellingPrice || 0);
          const cost = Number(i.costPrice || 0);
          return s + (sell - cost) * i.quantityRequested;
        }, 0), 0);

      const totalReservedQty = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityRequested, 0), 0);
      const totalReleasedQty = activeReqs.reduce((sum, r) =>
        sum + r.items.reduce((s, i) => s + i.quantityReleased, 0), 0);
      const conversionRate = totalReservedQty > 0
        ? Math.round((totalReleasedQty / totalReservedQty) * 1000) / 10
        : 0;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(threeDaysLater.getDate() + 3);

      const expiringReqs = finalApproved.filter(r => {
        if (!r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        const hasUnreleased = r.items.some(i => i.quantityReleased < i.quantityRequested);
        return hasUnreleased && endDate >= today && endDate <= threeDaysLater;
      });

      const expiredReqs = finalApproved.filter(r => {
        if (!r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        const hasUnreleased = r.items.some(i => i.quantityReleased < i.quantityRequested);
        return hasUnreleased && endDate < today;
      });

      const skuMap: Record<string, { reserved: number; available: number }> = {};
      for (const r of activeReqs) {
        for (const item of r.items) {
          const unreleased = Math.max(0, item.quantityRequested - item.quantityReleased);
          if (!skuMap[item.itemCode]) skuMap[item.itemCode] = { reserved: 0, available: Number(item.sellingPrice || 0) };
          skuMap[item.itemCode].reserved += unreleased;
        }
      }
      let highRiskValue = 0;
      for (const s of Object.values(skuMap)) {
        if (s.available > 0 && (s.reserved / s.available) * 100 > 70) {
          highRiskValue += s.reserved;
        }
      }

      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const trendData: { date: string; reserved: number; released: number }[] = [];
      for (let d = new Date(thirtyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const dayReqs = activeReqs.filter(r => r.requestDate === dateStr);
        trendData.push({
          date: dateStr,
          reserved: Math.round(dayReqs.reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0), 0)),
          released: Math.round(dayReqs.reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.quantityReleased * Number(i.costPrice || 0), 0), 0)),
        });
      }

      const branchValues: Record<string, number> = {};
      for (const r of activeReqs) {
        if (!branchValues[r.branchName]) branchValues[r.branchName] = 0;
        branchValues[r.branchName] += r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0);
      }
      const reservedByBranch = Object.entries(branchValues)
        .map(([name, value]) => ({ name, value: Math.round(value) }))
        .sort((a, b) => b.value - a.value);

      const alertItems = [...expiringReqs, ...expiredReqs].map(r => {
        const endDate = r.reservationEndDate ? new Date(r.reservationEndDate) : null;
        const daysRemaining = endDate ? Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const reservedVal = r.items.reduce((s, i) => s + i.quantityRequested * Number(i.costPrice || 0), 0);
        const expectedProfit = r.items.reduce((s, i) => {
          const sell = Number(i.sellingPrice || 0);
          const cost = Number(i.costPrice || 0);
          return s + (sell - cost) * i.quantityRequested;
        }, 0);
        let riskLevel = "low";
        if (daysRemaining < 0) riskLevel = "expired";
        else if (daysRemaining <= 3) riskLevel = "high";
        return {
          requestNumber: r.requestNumber,
          branch: r.branchName,
          reservedValue: Math.round(reservedVal),
          expectedProfit: Math.round(expectedProfit),
          expiryDate: r.reservationEndDate || "",
          riskLevel,
          requestId: r.id,
        };
      }).sort((a, b) => {
        const order: Record<string, number> = { expired: 0, high: 1, low: 2 };
        return (order[a.riskLevel] || 2) - (order[b.riskLevel] || 2);
      });

      res.json({
        kpis: {
          totalReservedValue: Math.round(totalReservedValue),
          frozenValue: Math.round(frozenValue),
          expectedGrossProfit: Math.round(expectedGrossProfit),
          conversionRate,
        },
        health: {
          expiringSoon: expiringReqs.length,
          expiredReservations: expiredReqs.length,
          highRiskValue: Math.round(highRiskValue),
        },
        trendData,
        reservedByBranch,
        alertItems,
      });
    } catch (err: any) {
      console.error("[Inventory Obligations Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/financial-exposure/export", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo } = req.query;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allBranches = await db.select().from(branches);
      const allUsersData = await storage.getUsers();

      const branchMap: Record<number, string> = {};
      for (const b of allBranches) branchMap[b.id] = b.name;

      const itemsByReqId: Record<number, typeof allItems> = {};
      for (const item of allItems) {
        if (!itemsByReqId[item.requestId]) itemsByReqId[item.requestId] = [];
        itemsByReqId[item.requestId].push(item);
      }

      let enrichedReqs = allReqs.map(r => ({
        ...r,
        items: itemsByReqId[r.id] || [],
        branchName: branchMap[r.branchId] || `Branch ${r.branchId}`,
        creator: allUsersData.find((u: any) => u.id === r.createdBy),
        salesRep: allUsersData.find((u: any) => u.id === r.salesRepId),
      }));

      if (dateFrom) enrichedReqs = enrichedReqs.filter(r => r.requestDate >= (dateFrom as string));
      if (dateTo) enrichedReqs = enrichedReqs.filter(r => r.requestDate <= (dateTo as string));

      const activeReqs = enrichedReqs.filter(r => r.status !== "rejected");

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "BaytAlebaa Inventory System";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Financial_Exposure");

      sheet.addRow(["Financial Exposure Report - BaytAlebaa Inventory System"]);
      sheet.mergeCells("A1:N1");
      const titleCell = sheet.getCell("A1");
      titleCell.font = { bold: true, size: 16, color: { argb: "FF1A5276" } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(1).height = 30;

      const totalReservedValue = activeReqs.reduce((s, r) => s + r.items.reduce((a, i) => a + i.quantityRequested * Number(i.costPrice || 0), 0), 0);
      const totalReleasedValue = activeReqs.reduce((s, r) => s + r.items.reduce((a, i) => a + i.quantityReleased * Number(i.costPrice || 0), 0), 0);
      const releasedPct = totalReservedValue > 0 ? Math.round((totalReleasedValue / totalReservedValue) * 100) : 0;

      sheet.addRow([]);
      sheet.addRow(["Total Reserved Value:", Math.round(totalReservedValue * 100) / 100, "", "Total Released Value:", Math.round(totalReleasedValue * 100) / 100, "", "Released %:", `${releasedPct}%`]);
      const filterParts: string[] = [];
      if (dateFrom) filterParts.push(`From: ${dateFrom}`);
      if (dateTo) filterParts.push(`To: ${dateTo}`);
      sheet.addRow(["Export Date:", new Date().toISOString().split("T")[0], "", "Filtered By:", filterParts.length > 0 ? filterParts.join("; ") : "No filters"]);

      for (const rowNum of [3, 4]) {
        const row = sheet.getRow(rowNum);
        row.eachCell((cell, colNumber) => {
          if (colNumber % 3 === 1) {
            cell.font = { bold: true, size: 11, color: { argb: "FF2C3E50" } };
          } else {
            cell.font = { size: 11 };
          }
        });
      }

      sheet.addRow([]);

      const headers = [
        "Request ID", "Branch", "Project Name", "Department", "Sales Rep",
        "SKU Code", "Product Description", "Brand", "Qty Reserved", "Qty Released",
        "Cost Price", "Reserved Value", "Released Value", "Age (Days)", "Status"
      ];
      const headerRow = sheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A5276" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      });
      headerRow.height = 25;

      const statusMap: Record<string, string> = {
        submitted: "Submitted", branch_approved: "Branch Approved",
        category_approved: "Category Approved", final_approved: "Final Approved", rejected: "Rejected",
      };

      let rowIndex = 0;
      for (const req of activeReqs) {
        const createdDate = new Date(req.createdAt);
        createdDate.setHours(0, 0, 0, 0);
        const ageDays = Math.floor((today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

        for (const item of req.items) {
          const reservedValue = item.quantityRequested * Number(item.costPrice || 0);
          const releasedValue = item.quantityReleased * Number(item.costPrice || 0);
          const dataRow = sheet.addRow([
            req.requestNumber,
            req.branchName,
            req.projectName,
            req.department,
            req.salesRep?.name || req.creator?.name || "",
            item.itemCode,
            item.itemDescription,
            item.brand,
            item.quantityRequested,
            item.quantityReleased,
            Number(item.costPrice || 0),
            Math.round(reservedValue * 100) / 100,
            Math.round(releasedValue * 100) / 100,
            ageDays,
            statusMap[req.status] || req.status,
          ]);

          dataRow.eachCell((cell) => {
            cell.border = {
              top: { style: "thin", color: { argb: "FFD5D8DC" } },
              bottom: { style: "thin", color: { argb: "FFD5D8DC" } },
              left: { style: "thin", color: { argb: "FFD5D8DC" } },
              right: { style: "thin", color: { argb: "FFD5D8DC" } },
            };
            cell.alignment = { vertical: "middle" };
          });

          if (rowIndex % 2 === 1) {
            dataRow.eachCell((cell) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F4" } };
            });
          }
          rowIndex++;
        }
      }

      sheet.columns = [
        { width: 14 }, { width: 16 }, { width: 22 }, { width: 16 }, { width: 16 },
        { width: 14 }, { width: 28 }, { width: 14 }, { width: 12 }, { width: 12 },
        { width: 12 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 16 },
      ];

      sheet.views = [{ state: "frozen", ySplit: 6, xSplit: 0 }];

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=Financial_Exposure_${new Date().toISOString().split("T")[0]}.xlsx`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("[Financial Exposure Export Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/profit", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo } = req.query;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allUsers = await storage.getUsers();
      const allBranches = await storage.getBranches();

      let filteredReqs = allReqs.filter(r => r.status !== "rejected" && r.status !== "submitted");
      if (dateFrom) filteredReqs = filteredReqs.filter(r => r.requestDate >= String(dateFrom));
      if (dateTo) filteredReqs = filteredReqs.filter(r => r.requestDate <= String(dateTo));

      const reqIds = new Set(filteredReqs.map(r => r.id));
      const filteredItems = allItems.filter(i => reqIds.has(i.requestId));

      let expectedProfit = 0;
      let actualProfit = 0;
      let frozenProfit = 0;
      let totalSalesValue = 0;
      let totalProfitValue = 0;

      const byBranch: Record<string, number> = {};
      const bySalesRep: Record<string, number> = {};
      const byProduct: Record<string, { code: string; desc: string; profit: number; salesValue: number; reservedQty: number }> = {};

      for (const item of filteredItems) {
        const req = filteredReqs.find(r => r.id === item.requestId)!;
        const sell = Number(item.sellingPrice || 0);
        const cost = Number(item.costPrice || 0);
        const profitPerUnit = sell - cost;
        
        const itemExpected = profitPerUnit * item.quantityRequested;
        const itemActual = profitPerUnit * (item.quantityReleased || 0);
        const itemSalesValue = sell * item.quantityRequested;
        
        expectedProfit += itemExpected;
        actualProfit += itemActual;
        totalSalesValue += itemSalesValue;
        totalProfitValue += itemExpected;

        if (req.status === "final_approved" && (item.quantityRequested - (item.quantityReleased || 0)) > 0) {
          frozenProfit += profitPerUnit * (item.quantityRequested - (item.quantityReleased || 0));
        }

        if (!byProduct[item.itemCode]) {
          byProduct[item.itemCode] = { code: item.itemCode, desc: item.itemDescription, profit: 0, salesValue: 0, reservedQty: 0 };
        }
        byProduct[item.itemCode].profit += itemExpected;
        byProduct[item.itemCode].salesValue += itemSalesValue;
        byProduct[item.itemCode].reservedQty += item.quantityRequested;

        const branch = allBranches.find(b => b.id === req.branchId)?.name || "Unknown";
        byBranch[branch] = (byBranch[branch] || 0) + itemExpected;

        const rep = allUsers.find(u => u.id === req.salesRepId)?.name || "Unknown";
        bySalesRep[rep] = (bySalesRep[rep] || 0) + itemExpected;
      }

      const weightedAvgMargin = totalSalesValue > 0 ? Math.round((totalProfitValue / totalSalesValue) * 100) : 0;

      const profitByBranch = Object.entries(byBranch).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
      const profitBySalesRep = Object.entries(bySalesRep).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
      const topProducts = Object.values(byProduct)
        .map(p => ({ code: p.code, desc: p.desc, profit: Math.round(p.profit), margin: p.salesValue > 0 ? Math.round((p.profit / p.salesValue) * 100) : 0, reservedQty: p.reservedQty }))
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 10);

      res.json({
        kpis: {
          expectedGrossProfit: Math.round(expectedProfit),
          actualGrossProfit: Math.round(actualProfit),
          frozenProfit: Math.round(frozenProfit),
          avgMargin: weightedAvgMargin,
        },
        profitByBranch,
        profitBySalesRep,
        topProducts,
      });
    } catch (err: any) {
      console.error("[Profit Intelligence Report Error]", err);
      res.status(500).json({ message: err.message });
    }
  });

  async function checkExpiringRequests() {
    try {
      // Auto-close sweep: final_approved requests where all items are fully released
      try {
        const closedRows = await db.execute(sql`
          UPDATE requests r SET status = 'closed', updated_at = NOW()
          WHERE r.status = 'final_approved'
            AND EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id)
            AND NOT EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id AND i.quantity_released < i.quantity_requested)
          RETURNING r.id
        `);
        for (const row of closedRows.rows as any[]) {
          await storage.createAuditLog({
            userId: 0,
            action: "auto_closed_fully_released",
            entity: "request",
            entityId: row.id,
            oldData: { status: "final_approved" },
            newData: { status: "closed" },
          });
        }
        if ((closedRows.rows as any[]).length > 0) {
          console.log(`[Scheduler] Auto-closed ${(closedRows.rows as any[]).length} fully released request(s)`);
        }
      } catch (err) {
        console.error("[Scheduler] Auto-close sweep error:", err);
      }

      const allReqs = await db.select().from(requests)
        .where(eq(requests.status, "final_approved"));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const req of allReqs) {
        if (!req.reservationEndDate) continue;

        const endDate = new Date(req.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) {
          const items = await db.select().from(requestItems).where(eq(requestItems.requestId, req.id));
          const hasUnreleased = items.some(i => i.quantityRequested - i.quantityReleased > 0);
          if (hasUnreleased) {
            await db.update(requests).set({ status: "expired", updatedAt: new Date() }).where(eq(requests.id, req.id));

            await storage.createAuditLog({
              userId: 0,
              action: "status changed to expired",
              entity: "request",
              entityId: req.id,
              oldData: { status: "final_approved" },
              newData: { status: "expired" },
            });

            const allUsers = await storage.getUsers();
            const notifySet = new Set<number>();
            const creator = allUsers.find(u => u.id === req.createdBy);
            const salesRep = req.salesRepId ? allUsers.find(u => u.id === req.salesRepId) : null;
            if (creator) notifySet.add(creator.id);
            if (salesRep) notifySet.add(salesRep.id);
            const bmIds7 = await getBranchManagerUserIds(req.branchId, allUsers);
            bmIds7.forEach(id => notifySet.add(id));
            allUsers.filter(u => u.role === "planning" || u.role === "admin").forEach(u => notifySet.add(u.id));

            for (const userId of notifySet) {
              await storage.createNotification(
                userId,
                "Reservation Expired",
                `Reservation for request #${req.requestNumber} has expired. Unreleased items returned to inventory.`,
                `/requests/${req.id}`
              );
            }

            const emailRecipients = [...notifySet].map(uid => {
              const u = allUsers.find(usr => usr.id === uid);
              return u ? { email: u.email, name: u.name, userId: u.id } : null;
            }).filter(Boolean) as { email: string; name: string; userId: number }[];

            if (emailRecipients.length > 0) {
              sendOrderEmail({
                eventType: "request_rejected" as EmailEventType,
                recipients: emailRecipients,
                requestNumber: req.requestNumber,
                requestId: req.id,
                projectName: req.projectName,
                actorName: "System",
                actorRole: "admin",
                notes: `Reservation for request #${req.requestNumber} has expired. Unreleased items returned to inventory.`,
              }).catch(err => console.error("[Email] Expired alert error:", err));
            }
          }
          continue;
        }

        if (diffDays > 3) continue;

        const items = await db.select().from(requestItems).where(eq(requestItems.requestId, req.id));
        const hasUnreleased = items.some(i => i.quantityRequested - i.quantityReleased > 0);
        if (!hasUnreleased) continue;

        const allUsers = await storage.getUsers();
        const creator = allUsers.find(u => u.id === req.createdBy);
        const salesRep = req.salesRepId ? allUsers.find(u => u.id === req.salesRepId) : null;
        const bmIds8 = await getBranchManagerUserIds(req.branchId, allUsers);
        const branchManagers = allUsers.filter(u => bmIds8.includes(u.id));
        const planningUsers = allUsers.filter(u => u.role === "planning");
        const admins = allUsers.filter(u => u.role === "admin");

        const notifySet = new Set<number>();
        if (creator) notifySet.add(creator.id);
        if (salesRep) notifySet.add(salesRep.id);
        branchManagers.forEach(u => notifySet.add(u.id));
        planningUsers.forEach(u => notifySet.add(u.id));
        admins.forEach(u => notifySet.add(u.id));

        let alertMsg: string;
        if (diffDays <= 0) {
          alertMsg = `Reservation for request #${req.requestNumber} has expired and items are not fully released!`;
        } else {
          alertMsg = `Reservation for request #${req.requestNumber} expires in ${diffDays} day(s) - items not fully released!`;
        }

        const existingNotifs = await db.select().from(notifications)
          .where(and(
            eq(notifications.link, `/requests/${req.id}`),
            eq(notifications.title, "Expiring Reservation")
          ));
        const todayStr = today.toISOString().split("T")[0];
        const alreadySentToday = existingNotifs.some(n => {
          const nDate = new Date(n.createdAt);
          return nDate.toISOString().split("T")[0] === todayStr;
        });

        if (alreadySentToday) continue;

        for (const userId of notifySet) {
          await storage.createNotification(
            userId,
            "Expiring Reservation",
            alertMsg,
            `/requests/${req.id}`
          );
        }

        const emailRecipients = [...notifySet].map(uid => {
          const u = allUsers.find(usr => usr.id === uid);
          return u ? { email: u.email, name: u.name, userId: u.id } : null;
        }).filter(Boolean) as { email: string; name: string; userId: number }[];

        if (emailRecipients.length > 0) {
          sendOrderEmail({
            eventType: "request_created" as EmailEventType,
            recipients: emailRecipients,
            requestNumber: req.requestNumber,
            requestId: req.id,
            projectName: req.projectName,
            actorName: "System",
            actorRole: "admin",
            notes: alertMsg,
          }).catch(err => console.error("[Email] Expiring alert error:", err));
        }
      }
      const expiredReqs = await db.select().from(requests)
        .where(eq(requests.status, "expired"));

      for (const req of expiredReqs) {
        if (!req.reservationEndDate) continue;

        const endDate = new Date(req.reservationEndDate);
        endDate.setHours(0, 0, 0, 0);
        const daysSinceExpiry = Math.ceil((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceExpiry >= 3) {
          const activeExtensions = await db.select().from(requestExtensions)
            .where(eq(requestExtensions.requestId, req.id));
          const hasPendingExtension = activeExtensions.some(ext =>
            ext.status !== "approved" && ext.status !== "rejected"
          );
          if (hasPendingExtension) continue;

          await db.update(requests).set({ status: "lost_opportunity", updatedAt: new Date() }).where(eq(requests.id, req.id));

          await storage.createAuditLog({
            userId: 0,
            action: "status changed to lost_opportunity",
            entity: "request",
            entityId: req.id,
            oldData: { status: "expired" },
            newData: { status: "lost_opportunity" },
          });

          const allUsers = await storage.getUsers();
          const notifySet = new Set<number>();
          const creator = allUsers.find(u => u.id === req.createdBy);
          const salesRep = req.salesRepId ? allUsers.find(u => u.id === req.salesRepId) : null;
          if (creator) notifySet.add(creator.id);
          if (salesRep) notifySet.add(salesRep.id);
          const bmIdsLO = await getBranchManagerUserIds(req.branchId, allUsers);
          bmIdsLO.forEach(id => notifySet.add(id));
          allUsers.filter(u => u.role === "planning" || u.role === "admin").forEach(u => notifySet.add(u.id));
          allUsers.filter(u => u.role === "category_manager" && u.productCategoryId && u.productCategoryId === req.productCategoryId).forEach(u => notifySet.add(u.id));

          for (const userId of notifySet) {
            await storage.createNotification(
              userId,
              "Lost Opportunity",
              `Request #${req.requestNumber} has been converted to Lost Opportunity — reservation expired without renewal.`,
              `/requests/${req.id}`
            );
          }

          const emailRecipients = [...notifySet].map(uid => {
            const u = allUsers.find(usr => usr.id === uid);
            return u ? { email: u.email, name: u.name, userId: u.id } : null;
          }).filter(Boolean) as { email: string; name: string; userId: number }[];

          if (emailRecipients.length > 0) {
            sendOrderEmail({
              eventType: "request_rejected" as EmailEventType,
              recipients: emailRecipients,
              requestNumber: req.requestNumber,
              requestId: req.id,
              projectName: req.projectName,
              actorName: "System",
              actorRole: "admin",
              notes: `Request #${req.requestNumber} has been converted to Lost Opportunity. The reservation expired 3 days ago without renewal.\nالطلب #${req.requestNumber} تم تحويله إلى فرصة ضائعة. الحجز انتهى منذ 3 أيام بدون تجديد.`,
            }).catch(err => console.error("[Email] Lost opportunity alert error:", err));
          }
        }
      }
    } catch (err) {
      console.error("[Scheduler] Error checking expiring requests:", err);
    }
  }

  setTimeout(() => {
    checkExpiringRequests().catch(err => console.error("[Scheduler] checkExpiringRequests error:", err));
  }, 30000);
  setInterval(() => {
    checkExpiringRequests().catch(err => console.error("[Scheduler] checkExpiringRequests error:", err));
  }, 6 * 60 * 60 * 1000);

  app.get("/api/reports/product-performance", authMiddleware, roleMiddleware("planning", "admin"), async (req: Request, res: Response) => {
    try {
      const { category, brand, warehouse, dateFrom, dateTo } = req.query;
      const allProducts = await storage.getProducts();
      const allItems = await db.select().from(requestItems);
      const allReqs = await db.select().from(requests);
      const allBranchesData = await db.select().from(branches);

      const branchMap: Record<number, string> = {};
      for (const b of allBranchesData) branchMap[b.id] = b.name;

      let filteredReqs = allReqs;
      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);
      const filteredReqIds = new Set(filteredReqs.map(r => r.id));

      let filteredItems = allItems.filter(it => filteredReqIds.has(it.requestId));

      const productMap: Record<string, {
        code: string; description: string; brand: string; category: string;
        costPrice: number; sellingPrice: number; availableQuantity: number;
        totalRequested: number; totalReleased: number; requestCount: number;
        warehouses: Set<string>;
      }> = {};

      for (const p of allProducts) {
        if (category && typeof category === "string" && p.category !== category) continue;
        if (brand && typeof brand === "string" && p.brand !== brand) continue;
        productMap[p.itemCode] = {
          code: p.itemCode,
          description: p.description,
          brand: p.brand,
          category: p.category,
          costPrice: Number(p.costPrice),
          sellingPrice: Number(p.sellingPrice),
          availableQuantity: p.availableQuantity,
          totalRequested: 0,
          totalReleased: 0,
          requestCount: 0,
          warehouses: new Set(),
        };
      }

      for (const item of filteredItems) {
        const pm = productMap[item.itemCode];
        if (!pm) continue;
        if (warehouse && typeof warehouse === "string" && item.warehouse !== warehouse) continue;
        pm.totalRequested += item.quantityRequested;
        pm.totalReleased += item.quantityReleased || 0;
        pm.requestCount++;
        pm.warehouses.add(item.warehouse);
      }

      const productRows = Object.values(productMap).map(p => {
        const totalProfit = (p.sellingPrice - p.costPrice) * p.totalReleased;
        const potentialProfit = (p.sellingPrice - p.costPrice) * p.totalRequested;
        const marginPercent = p.sellingPrice > 0 ? ((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100 : 0;
        const turnoverRate = p.availableQuantity > 0 ? p.totalReleased / p.availableQuantity : 0;
        const reservationRatio = (p.availableQuantity + p.totalRequested) > 0 ? (p.totalRequested / (p.availableQuantity + p.totalRequested)) * 100 : 0;
        const inventoryValue = p.costPrice * p.availableQuantity;
        const potentialRevenue = p.sellingPrice * p.availableQuantity;
        return {
          code: p.code,
          description: p.description,
          brand: p.brand,
          category: p.category,
          costPrice: p.costPrice,
          sellingPrice: p.sellingPrice,
          availableQuantity: p.availableQuantity,
          totalRequested: p.totalRequested,
          totalReleased: p.totalReleased,
          requestCount: p.requestCount,
          totalProfit: Math.round(totalProfit),
          potentialProfit: Math.round(potentialProfit),
          marginPercent: Math.round(marginPercent * 100) / 100,
          turnoverRate: Math.round(turnoverRate * 100) / 100,
          reservationRatio: Math.round(reservationRatio * 100) / 100,
          inventoryValue: Math.round(inventoryValue),
          potentialRevenue: Math.round(potentialRevenue),
          warehouses: Array.from(p.warehouses),
        };
      });

      const totalProducts = productRows.length;
      const totalInventoryValue = productRows.reduce((s, p) => s + p.inventoryValue, 0);
      const totalPotentialSalesValue = productRows.reduce((s, p) => s + p.potentialRevenue, 0);
      const avgMargin = totalProducts > 0 ? productRows.reduce((s, p) => s + p.marginPercent, 0) / totalProducts : 0;

      const sortedByProfit = [...productRows].sort((a, b) => b.totalProfit - a.totalProfit);
      const topProfitProduct = sortedByProfit[0] || null;

      const frozenCapitalProducts = productRows.filter(p => p.reservationRatio > 50 && p.totalReleased === 0);
      const frozenCapitalValue = frozenCapitalProducts.reduce((s, p) => s + (p.costPrice * p.totalRequested), 0);

      const top10Revenue = [...productRows].sort((a, b) => (b.sellingPrice * b.totalReleased) - (a.sellingPrice * a.totalReleased)).slice(0, 10).map(p => ({
        name: p.description.length > 25 ? p.description.substring(0, 22) + "..." : p.description,
        code: p.code,
        revenue: Math.round(p.sellingPrice * p.totalReleased),
      }));

      const top10Profit = [...productRows].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 10).map(p => ({
        name: p.description.length > 25 ? p.description.substring(0, 22) + "..." : p.description,
        code: p.code,
        profit: p.totalProfit,
      }));

      const categoryBreakdown = productRows.reduce<Record<string, { count: number; value: number; profit: number }>>((acc, p) => {
        if (!acc[p.category]) acc[p.category] = { count: 0, value: 0, profit: 0 };
        acc[p.category].count++;
        acc[p.category].value += p.inventoryValue;
        acc[p.category].profit += p.totalProfit;
        return acc;
      }, {});

      const categoryChart = Object.entries(categoryBreakdown).map(([name, d]) => ({
        name,
        count: d.count,
        value: d.value,
        profit: d.profit,
      }));

      const slowMoving = productRows.filter(p => p.requestCount === 0 && p.availableQuantity > 0);
      const highDemand = [...productRows].filter(p => p.totalRequested > p.availableQuantity).sort((a, b) => (b.totalRequested - b.availableQuantity) - (a.totalRequested - a.availableQuantity));
      const highMarginProducts = [...productRows].filter(p => p.marginPercent > 30 && p.totalReleased > 0).sort((a, b) => b.totalProfit - a.totalProfit);

      const allCategories = [...new Set(allProducts.map(p => p.category))].sort();
      const allBrands = [...new Set(allProducts.map(p => p.brand))].sort();
      const allWarehouses = [...new Set(allItems.map(i => i.warehouse))].sort();

      res.json({
        kpis: {
          totalProducts,
          totalInventoryValue,
          totalPotentialSalesValue,
          topProfitProduct: topProfitProduct ? { code: topProfitProduct.code, description: topProfitProduct.description, profit: topProfitProduct.totalProfit } : null,
          avgMargin: Math.round(avgMargin * 100) / 100,
          frozenCapitalValue: Math.round(frozenCapitalValue),
        },
        products: productRows.sort((a, b) => b.totalProfit - a.totalProfit),
        charts: { top10Revenue, top10Profit, categoryChart },
        insights: {
          slowMovingCount: slowMoving.length,
          slowMovingValue: slowMoving.reduce((s, p) => s + p.inventoryValue, 0),
          highDemandCount: highDemand.length,
          topHighDemand: highDemand.slice(0, 3).map(p => ({ code: p.code, description: p.description, gap: p.totalRequested - p.availableQuantity })),
          highMarginCount: highMarginProducts.length,
          topHighMargin: highMarginProducts.slice(0, 3).map(p => ({ code: p.code, description: p.description, margin: p.marginPercent })),
          frozenCapitalCount: frozenCapitalProducts.length,
        },
        filters: { categories: allCategories, brands: allBrands, warehouses: allWarehouses },
      });
    } catch (err) {
      console.error("[Product Performance Report] Error:", err);
      res.status(500).json({ message: "Failed to generate product performance report" });
    }
  });

  // ====== Main Reports Summary ======
  const VALID_STATUS_FILTERS = ["ALL", "FINAL_APPROVED", "FULLY_RELEASED", "PARTIALLY_RELEASED", "EXPIRED"];

  function applyStatusFilter(
    reqs: typeof requests.$inferSelect[],
    items: typeof requestItems.$inferSelect[],
    statusFilter: string
  ): typeof requests.$inferSelect[] {
    if (!statusFilter || statusFilter === "ALL") return reqs;
    if (!VALID_STATUS_FILTERS.includes(statusFilter)) return reqs;

    const itemsByReq: Record<number, { totalQty: number; releasedQty: number }> = {};
    for (const item of items) {
      if (!itemsByReq[item.requestId]) itemsByReq[item.requestId] = { totalQty: 0, releasedQty: 0 };
      itemsByReq[item.requestId].totalQty += item.quantityRequested;
      itemsByReq[item.requestId].releasedQty += (item.quantityReleased ?? 0);
    }

    const isFinalApproved = (s: string) => {
      const lower = s?.toLowerCase();
      return lower === "final_approved" || lower === "closed";
    };

    const now = new Date();

    const result = reqs.filter(r => {
      const agg = itemsByReq[r.id] || { totalQty: 0, releasedQty: 0 };
      switch (statusFilter) {
        case "FINAL_APPROVED":
          return isFinalApproved(r.status);
        case "FULLY_RELEASED":
          return isFinalApproved(r.status) && agg.totalQty > 0 && agg.releasedQty >= agg.totalQty;
        case "PARTIALLY_RELEASED":
          return isFinalApproved(r.status) && agg.releasedQty > 0 && agg.releasedQty < agg.totalQty;
        case "EXPIRED": {
          if (!isFinalApproved(r.status)) return false;
          if (!r.reservationEndDate) return false;
          const endDate = new Date(r.reservationEndDate);
          return endDate < now && agg.releasedQty < agg.totalQty;
        }
        default:
          return true;
      }
    });

    return result;
  }

  app.get("/api/main-reports/summary", authMiddleware, roleMiddleware("planning", "admin", "sector_head", "category_manager", "branch_manager", "sales_rep"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo, status } = req.query;
      const statusFilter = typeof status === "string" ? status : "ALL";
      if (statusFilter !== "ALL" && !VALID_STATUS_FILTERS.includes(statusFilter)) {
        return res.status(400).json({ message: "Invalid status filter" });
      }
      const reportingUser = (req as any).user;
      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);

      let filteredReqs = allReqs;

      if (reportingUser?.role === "sales_rep") {
        filteredReqs = filteredReqs.filter(r => r.salesRepId === reportingUser.id || r.createdBy === reportingUser.id);
      } else if (reportingUser?.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(reportingUser.id, reportingUser.branchId ?? null);
        const allUsersForBranch = await storage.getUsers();
        const salesRepIdsInBranch = new Set(
          allUsersForBranch
            .filter((u: any) => u.role === "sales_rep" && branchIds.includes(u.branchId))
            .map((u: any) => u.id)
        );
        filteredReqs = filteredReqs.filter(r => salesRepIdsInBranch.has(r.salesRepId) || salesRepIdsInBranch.has(r.createdBy));
      }

      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);
      filteredReqs = applyStatusFilter(filteredReqs, allItems, statusFilter);
      const filteredReqIds = new Set(filteredReqs.map(r => r.id));
      const filteredItems = allItems.filter(it => filteredReqIds.has(it.requestId));

      const rejectedReqIds = new Set(filteredReqs.filter(r => r.status === "rejected").map(r => r.id));
      const activeItems = filteredItems.filter(it => !rejectedReqIds.has(it.requestId));
      const rejectedItemsList = filteredItems.filter(it => rejectedReqIds.has(it.requestId));

      const uniqueCustomers = new Set(filteredReqs.map(r => r.customerName).filter(Boolean));
      const uniqueProjects = new Set(filteredReqs.map(r => r.projectName).filter(Boolean));

      let totalReservedQty = 0, totalReleasedQty = 0, totalRejectedQty = 0;
      let totalReservedValue = 0, totalReleasedValue = 0;
      let totalReservedCost = 0, totalReleasedCost = 0;
      let totalReservedProfit = 0, totalReleasedProfit = 0;

      for (const item of activeItems) {
        const sp = Number(item.sellingPrice) || 0;
        const cp = Number(item.costPrice) || 0;
        const qReq = item.quantityRequested;
        const qRel = item.quantityReleased || 0;
        totalReservedQty += qReq;
        totalReleasedQty += qRel;
        totalReservedValue += sp * qReq;
        totalReleasedValue += sp * qRel;
        totalReservedCost += cp * qReq;
        totalReleasedCost += cp * qRel;
        if (cp > 0) {
          const margin = sp - cp;
          totalReservedProfit += margin * qReq;
          totalReleasedProfit += margin * qRel;
        }
      }
      for (const item of rejectedItemsList) {
        totalRejectedQty += item.quantityRequested;
      }

      const frozenQty = totalReservedQty - totalReleasedQty;
      const frozenValue = totalReservedValue - totalReleasedValue;
      const conversionRate = totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0;

      let totalApprovalHours = 0;
      let approvalCount = 0;
      for (const r of filteredReqs) {
        if (r.status === "final_approved" && r.createdAt && r.updatedAt) {
          const created = new Date(r.createdAt).getTime();
          const updated = new Date(r.updatedAt).getTime();
          if (updated > created) {
            totalApprovalHours += (updated - created) / (1000 * 60 * 60);
            approvalCount++;
          }
        }
      }
      const avgApprovalTime = approvalCount > 0 ? Math.round(totalApprovalHours / approvalCount) : 0;

      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      const expiringIn72h = filteredReqs.filter(r => {
        if (r.status !== "final_approved" || !r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        return endDate >= now && endDate <= in72h;
      }).length;

      const expiredUnreleased = filteredReqs.filter(r => {
        if (r.status !== "final_approved" || !r.reservationEndDate) return false;
        const endDate = new Date(r.reservationEndDate);
        return endDate < now;
      }).length;

      // Status distribution for chart
      const statusCounts: Record<string, number> = {};
      for (const r of filteredReqs) {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      }
      const statusChart = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

      // Monthly trend
      const monthlyTrend: Record<string, { month: string; reserved: number; released: number }> = {};
      for (const r of filteredReqs) {
        const month = r.requestDate ? r.requestDate.substring(0, 7) : "Unknown";
        if (!monthlyTrend[month]) monthlyTrend[month] = { month, reserved: 0, released: 0 };
      }
      for (const item of filteredItems) {
        const req = filteredReqs.find(r => r.id === item.requestId);
        if (!req) continue;
        const month = req.requestDate ? req.requestDate.substring(0, 7) : "Unknown";
        if (!monthlyTrend[month]) monthlyTrend[month] = { month, reserved: 0, released: 0 };
        const sp = Number(item.sellingPrice) || 0;
        monthlyTrend[month].reserved += sp * item.quantityRequested;
        monthlyTrend[month].released += sp * (item.quantityReleased || 0);
      }
      const trendChart = Object.values(monthlyTrend).sort((a, b) => a.month.localeCompare(b.month));

      res.json({
        kpis: {
          totalRequests: filteredReqs.length,
          totalCustomers: uniqueCustomers.size,
          totalProjects: uniqueProjects.size,
          totalReservedQty,
          totalReleasedQty,
          totalRejectedQty,
          frozenQty,
          conversionRate,
          avgApprovalTime,
          totalReservedValue: Math.round(totalReservedValue),
          totalReleasedValue: Math.round(totalReleasedValue),
          frozenValue: Math.round(frozenValue),
          totalReservedCost: Math.round(totalReservedCost),
          totalReleasedCost: Math.round(totalReleasedCost),
          frozenCost: Math.round(totalReservedCost - totalReleasedCost),
          totalReservedProfit: Math.round(totalReservedProfit),
          totalReleasedProfit: Math.round(totalReleasedProfit),
          frozenProfit: Math.round(totalReservedProfit - totalReleasedProfit),
          expiringIn72h,
          expiredUnreleased,
        },
        statusChart,
        trendChart,
      });
    } catch (err) {
      console.error("[Main Reports Summary] Error:", err);
      res.status(500).json({ message: "Failed to generate summary report" });
    }
  });

  // ====== Main Reports Excel Export ======
  app.get("/api/main-reports/export", authMiddleware, roleMiddleware("planning", "admin", "sector_head", "category_manager", "branch_manager", "sales_rep"), async (req: Request, res: Response) => {
    try {
      const { dateFrom, dateTo, status } = req.query;
      const exportStatusFilter = typeof status === "string" ? status : "ALL";
      if (exportStatusFilter !== "ALL" && !VALID_STATUS_FILTERS.includes(exportStatusFilter)) {
        return res.status(400).json({ message: "Invalid status filter" });
      }
      const exportingUser = (req as any).user;
      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allBranchesData = await db.select().from(branches);
      const allProducts = await storage.getProducts();

      const branchMap: Record<number, string> = {};
      for (const b of allBranchesData) branchMap[b.id] = b.name;
      const productMap: Record<string, { costPrice: number; sellingPrice: number; category: string }> = {};
      for (const p of allProducts) {
        productMap[p.itemCode] = { costPrice: Number(p.costPrice), sellingPrice: Number(p.sellingPrice), category: p.category };
      }

      let filteredReqs = allReqs;

      if (exportingUser?.role === "sales_rep") {
        filteredReqs = filteredReqs.filter(r => r.salesRepId === exportingUser.id || r.createdBy === exportingUser.id);
      } else if (exportingUser?.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(exportingUser.id, exportingUser.branchId ?? null);
        const allUsersForBranch = await storage.getUsers();
        const salesRepIdsInBranch = new Set(
          allUsersForBranch
            .filter((u: any) => u.role === "sales_rep" && branchIds.includes(u.branchId))
            .map((u: any) => u.id)
        );
        filteredReqs = filteredReqs.filter(r => salesRepIdsInBranch.has(r.salesRepId) || salesRepIdsInBranch.has(r.createdBy));
      }

      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);
      filteredReqs = applyStatusFilter(filteredReqs, allItems, exportStatusFilter);
      const filteredReqIds = new Set(filteredReqs.map(r => r.id));
      const filteredItems = allItems.filter(it => filteredReqIds.has(it.requestId));

      const reqMap: Record<number, typeof allReqs[0]> = {};
      for (const r of filteredReqs) reqMap[r.id] = r;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "BaytAlebaa System";

      const headerStyle: Partial<ExcelJS.Style> = {
        font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } },
        alignment: { horizontal: "center", vertical: "middle" },
        border: {
          top: { style: "thin" }, bottom: { style: "thin" },
          left: { style: "thin" }, right: { style: "thin" },
        },
      };

      // --- Summary Sheet ---
      const summarySheet = workbook.addWorksheet("Summary");
      const uniqueCustomers = new Set(filteredReqs.map(r => r.customerName).filter(Boolean));
      const uniqueProjects = new Set(filteredReqs.map(r => r.projectName).filter(Boolean));
      let totalReservedQty = 0, totalReleasedQty = 0;
      let totalReservedValue = 0, totalReleasedValue = 0;
      for (const item of filteredItems) {
        const sp = Number(item.sellingPrice) || 0;
        totalReservedQty += item.quantityRequested;
        totalReleasedQty += item.quantityReleased || 0;
        totalReservedValue += sp * item.quantityRequested;
        totalReleasedValue += sp * (item.quantityReleased || 0);
      }
      const frozenQty = totalReservedQty - totalReleasedQty;
      const frozenValue = totalReservedValue - totalReleasedValue;
      const conversionRate = totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0;

      summarySheet.columns = [
        { header: "KPI", key: "kpi", width: 30 },
        { header: "Value", key: "value", width: 25 },
      ];
      const summaryHeaderRow = summarySheet.getRow(1);
      summaryHeaderRow.eachCell(cell => { cell.style = headerStyle as ExcelJS.Style; });

      const summaryRows = [
        { kpi: "Total Requests / عدد الطلبات", value: filteredReqs.length },
        { kpi: "Total Customers / عدد العملاء", value: uniqueCustomers.size },
        { kpi: "Total Projects / عدد المشاريع", value: uniqueProjects.size },
        { kpi: "Total Reserved Qty / الكمية المحجوزة", value: totalReservedQty },
        { kpi: "Total Released Qty / الكمية المصروفة", value: totalReleasedQty },
        { kpi: "Frozen Qty / الكمية المجمدة", value: frozenQty },
        { kpi: "Conversion Rate / نسبة التحويل", value: `${conversionRate}%` },
        { kpi: "Total Reserved Value / قيمة المحجوز", value: Math.round(totalReservedValue) },
        { kpi: "Total Released Value / قيمة المصروف", value: Math.round(totalReleasedValue) },
        { kpi: "Frozen Value / القيمة المجمدة", value: Math.round(frozenValue) },
      ];
      for (const row of summaryRows) summarySheet.addRow(row);

      // --- Dimension Sheets ---
      const dims = [
        { name: "By Customer", key: "customer" },
        { name: "By Project", key: "project" },
        { name: "By Product", key: "product" },
        { name: "By Sales Outlet", key: "branch" },
        { name: "By Brand", key: "brand" },
        { name: "By Sales Channel", key: "department" },
        { name: "By Category", key: "category" },
      ];

      for (const dim of dims) {
        const groups: Record<string, { requestIds: Set<number>; reservedQty: number; releasedQty: number; reservedValue: number; releasedValue: number; profit: number }> = {};

        const getDimKey = (item: typeof allItems[0]): string => {
          const req = reqMap[item.requestId];
          if (!req) return "Unknown";
          switch (dim.key) {
            case "customer": return req.customerName || "Unknown";
            case "project": return req.projectName || "Unknown";
            case "branch": return branchMap[req.branchId] || "Unknown";
            case "department": return req.department || "Unknown";
            case "brand": return item.brand || "Unknown";
            case "category": {
              const prod = productMap[item.itemCode];
              return prod?.category || "Unknown";
            }
            case "product": return item.itemCode || "Unknown";
            default: return "Unknown";
          }
        };

        for (const item of filteredItems) {
          const key = getDimKey(item);
          if (!groups[key]) groups[key] = { requestIds: new Set(), reservedQty: 0, releasedQty: 0, reservedValue: 0, releasedValue: 0, profit: 0 };
          const g = groups[key];
          g.requestIds.add(item.requestId);
          g.reservedQty += item.quantityRequested;
          g.releasedQty += item.quantityReleased || 0;
          const sp = Number(item.sellingPrice) || 0;
          const cp = Number(item.costPrice) || 0;
          g.reservedValue += sp * item.quantityRequested;
          g.releasedValue += sp * (item.quantityReleased || 0);
          g.profit += (sp - cp) * (item.quantityReleased || 0);
        }

        const rows = Object.entries(groups).map(([name, g]) => ({
          name,
          requestCount: g.requestIds.size,
          reservedQty: g.reservedQty,
          releasedQty: g.releasedQty,
          reservedValue: Math.round(g.reservedValue),
          releasedValue: Math.round(g.releasedValue),
          releaseRate: g.reservedQty > 0 ? Math.round((g.releasedQty / g.reservedQty) * 100) : 0,
        })).sort((a, b) => b.reservedValue - a.reservedValue);

        const sheet = workbook.addWorksheet(dim.name);
        sheet.columns = [
          { header: "Name", key: "name", width: 30 },
          { header: "Requests", key: "requestCount", width: 12 },
          { header: "Reserved Qty", key: "reservedQty", width: 15 },
          { header: "Released Qty", key: "releasedQty", width: 15 },
          { header: "Reserved Value", key: "reservedValue", width: 18 },
          { header: "Released Value", key: "releasedValue", width: 18 },
          { header: "Release Rate %", key: "releaseRate", width: 15 },
        ];
        const hRow = sheet.getRow(1);
        hRow.eachCell(cell => { cell.style = headerStyle as ExcelJS.Style; });

        for (const row of rows) sheet.addRow(row);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=Main_Reports_${new Date().toISOString().split("T")[0]}.xlsx`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err) {
      console.error("[Main Reports Export] Error:", err);
      res.status(500).json({ message: "Failed to export main reports" });
    }
  });

  // ====== Reports by Dimension (shared pattern) ======
  const dimensionEndpoints = [
    { path: "customer", label: "Customer" },
    { path: "project", label: "Project" },
    { path: "branch", label: "Branch" },
    { path: "brand", label: "Brand" },
    { path: "department", label: "Department" },
    { path: "category", label: "Category" },
    { path: "product", label: "Product" },
  ];

  for (const dim of dimensionEndpoints) {
    app.get(`/api/reports/by-${dim.path}`, authMiddleware, roleMiddleware("planning", "admin", "sector_head", "category_manager", "branch_manager", "sales_rep"), async (req: Request, res: Response) => {
      try {
        const { dateFrom, dateTo, status } = req.query;
        const statusFilterVal = typeof status === "string" ? status : "ALL";
        if (statusFilterVal !== "ALL" && !VALID_STATUS_FILTERS.includes(statusFilterVal)) {
          return res.status(400).json({ message: "Invalid status filter" });
        }
        const dimUser = (req as any).user;
        const allReqs = await db.select().from(requests);
        const allItems = await db.select().from(requestItems);
        const allBranchesData = await db.select().from(branches);
        const allProducts = await storage.getProducts();

        const branchMap: Record<number, string> = {};
        for (const b of allBranchesData) branchMap[b.id] = b.name;

        const productMap: Record<string, { costPrice: number; sellingPrice: number; category: string }> = {};
        for (const p of allProducts) {
          productMap[p.itemCode] = { costPrice: Number(p.costPrice), sellingPrice: Number(p.sellingPrice), category: p.category };
        }

        let filteredReqs = allReqs;

        if (dimUser?.role === "sales_rep") {
          filteredReqs = filteredReqs.filter(r => r.salesRepId === dimUser.id || r.createdBy === dimUser.id);
        } else if (dimUser?.role === "branch_manager") {
          const branchIds = await storage.getUserBranchIds(dimUser.id, dimUser.branchId ?? null);
          const allUsersForBranch = await storage.getUsers();
          const salesRepIdsInBranch = new Set(
            allUsersForBranch
              .filter((u: any) => u.role === "sales_rep" && branchIds.includes(u.branchId))
              .map((u: any) => u.id)
          );
          filteredReqs = filteredReqs.filter(r => salesRepIdsInBranch.has(r.salesRepId) || salesRepIdsInBranch.has(r.createdBy));
        }

        if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
        if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);
        filteredReqs = applyStatusFilter(filteredReqs, allItems, statusFilterVal);
        const filteredReqIds = new Set(filteredReqs.map(r => r.id));
        const filteredItems = allItems.filter(it => filteredReqIds.has(it.requestId));

        const reqMap: Record<number, typeof allReqs[0]> = {};
        for (const r of filteredReqs) reqMap[r.id] = r;

        const groups: Record<string, { requestIds: Set<number>; reservedQty: number; releasedQty: number; rejectedQty: number; expiredQty: number; lostOpportunityQty: number; reservedValue: number; releasedValue: number; reservedCost: number; releasedCost: number; profit: number }> = {};

        const dimRejectedReqIds = new Set(filteredReqs.filter(r => r.status === "rejected").map(r => r.id));
        const dimExpiredReqIds = new Set(filteredReqs.filter(r => r.status === "expired").map(r => r.id));
        const dimLostOpportunityReqIds = new Set(filteredReqs.filter(r => r.status === "lost_opportunity" || r.status === "confirmed_lost_opportunity").map(r => r.id));

        const normalizeKey = (s: string | null | undefined): string => {
          if (!s) return "";
          return s
            .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        };
        const getDimKey = (item: typeof allItems[0]): string => {
          const req = reqMap[item.requestId];
          if (!req) return "Unknown";
          switch (dim.path) {
            case "customer": return normalizeKey(req.customerName) || "Unknown";
            case "project": return normalizeKey(req.projectName) || "Unknown";
            case "branch": return normalizeKey(branchMap[req.branchId]) || "Unknown";
            case "department": return normalizeKey(req.department) || "Unknown";
            case "brand": return normalizeKey(item.brand) || "Unknown";
            case "category": {
              const prod = productMap[item.itemCode];
              return normalizeKey(prod?.category) || "Unknown";
            }
            case "product": return normalizeKey(item.itemCode) || "Unknown";
            default: return "Unknown";
          }
        };

        for (const item of filteredItems) {
          const key = getDimKey(item);
          if (!groups[key]) groups[key] = { requestIds: new Set(), reservedQty: 0, releasedQty: 0, rejectedQty: 0, expiredQty: 0, lostOpportunityQty: 0, reservedValue: 0, releasedValue: 0, reservedCost: 0, releasedCost: 0, profit: 0 };
          const g = groups[key];
          g.requestIds.add(item.requestId);
          const isRejected = dimRejectedReqIds.has(item.requestId);
          const isExpired = dimExpiredReqIds.has(item.requestId);
          const isLostOpportunity = dimLostOpportunityReqIds.has(item.requestId);
          if (isRejected) {
            g.rejectedQty += item.quantityRequested;
          } else if (isLostOpportunity) {
            g.lostOpportunityQty += item.quantityRequested - (item.quantityReleased || 0);
          } else {
            g.reservedQty += item.quantityRequested;
            g.releasedQty += item.quantityReleased || 0;
            if (isExpired) {
              g.expiredQty += item.quantityRequested - (item.quantityReleased || 0);
            }
            const sp = Number(item.sellingPrice) || 0;
            const cp = Number(item.costPrice) || 0;
            g.reservedValue += sp * item.quantityRequested;
            g.releasedValue += sp * (item.quantityReleased || 0);
            g.reservedCost += cp * item.quantityRequested;
            g.releasedCost += cp * (item.quantityReleased || 0);
            g.profit += (sp - cp) * (item.quantityReleased || 0);
          }
        }

        const rows = Object.entries(groups).map(([name, g]) => ({
          name,
          requestCount: g.requestIds.size,
          reservedQty: g.reservedQty,
          releasedQty: g.releasedQty,
          rejectedQty: g.rejectedQty,
          expiredQty: g.expiredQty,
          lostOpportunityQty: g.lostOpportunityQty,
          reservedValue: Math.round(g.reservedValue),
          releasedValue: Math.round(g.releasedValue),
          reservedCost: Math.round(g.reservedCost),
          releasedCost: Math.round(g.releasedCost),
          releaseRate: g.reservedQty > 0 ? Math.round((g.releasedQty / g.reservedQty) * 100) : 0,
        })).sort((a, b) => b.reservedValue - a.reservedValue);

        const totalRequests = new Set(filteredItems.map(i => i.requestId)).size;
        const totalReservedQty = rows.reduce((s, r) => s + r.reservedQty, 0);
        const totalReleasedQty = rows.reduce((s, r) => s + r.releasedQty, 0);
        const totalRejectedQty = rows.reduce((s, r) => s + r.rejectedQty, 0);
        const totalExpiredQty = rows.reduce((s, r) => s + r.expiredQty, 0);
        const totalLostOpportunityQty = rows.reduce((s, r) => s + r.lostOpportunityQty, 0);
        const totalReservedValue = rows.reduce((s, r) => s + r.reservedValue, 0);
        const totalReleasedValue = rows.reduce((s, r) => s + r.releasedValue, 0);

        res.json({
          kpis: {
            totalRequests,
            totalReservedQty,
            totalReleasedQty,
            totalRejectedQty,
            totalExpiredQty,
            totalLostOpportunityQty,
            releaseRate: totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0,
            totalReservedValue,
            totalReleasedValue,
          },
          rows,
          chart: rows.slice(0, 10).map(r => ({ name: r.name.length > 20 ? r.name.substring(0, 17) + "..." : r.name, reserved: r.reservedValue, released: r.releasedValue })),
        });
      } catch (err) {
        console.error(`[Report by ${dim.label}] Error:`, err);
        res.status(500).json({ message: `Failed to generate ${dim.label} report` });
      }
    });
  }

  app.get("/api/reports/category-detail/:categoryName", authMiddleware, roleMiddleware("planning", "admin", "sector_head", "category_manager", "branch_manager", "sales_rep"), async (req: Request, res: Response) => {
    try {
      const categoryName = decodeURIComponent(req.params.categoryName as string);
      const { dateFrom, dateTo } = req.query;
      const catDetailUser = (req as any).user;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allProducts = await storage.getProducts();
      const allUsers = await storage.getUsers();
      const allBranchesData = await db.select().from(branches);

      const branchMap: Record<number, string> = {};
      for (const b of allBranchesData) branchMap[b.id] = b.name;

      const userMap: Record<number, string> = {};
      for (const u of allUsers) userMap[u.id] = u.name;

      const categoryItemCodes = new Set(
        allProducts.filter(p => p.category === categoryName).map(p => p.itemCode)
      );

      let filteredReqs = allReqs;

      if (catDetailUser?.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(catDetailUser.id, catDetailUser.branchId ?? null);
        const salesRepIdsInBranch = new Set(
          allUsers.filter((u: any) => u.role === "sales_rep" && branchIds.includes(u.branchId)).map((u: any) => u.id)
        );
        filteredReqs = filteredReqs.filter(r => salesRepIdsInBranch.has(r.salesRepId) || salesRepIdsInBranch.has(r.createdBy));
      }
      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);

      const filteredReqIds = new Set(filteredReqs.map(r => r.id));
      const reqMap: Record<number, typeof allReqs[0]> = {};
      for (const r of filteredReqs) reqMap[r.id] = r;

      const categoryItems = allItems.filter(it => categoryItemCodes.has(it.itemCode) && filteredReqIds.has(it.requestId));
      const requestIdsWithCategory = new Set(categoryItems.map(it => it.requestId));

      const requestsWithCategory = filteredReqs.filter(r => requestIdsWithCategory.has(r.id));

      const rejectedReqIds = new Set(requestsWithCategory.filter(r => r.status === "rejected").map(r => r.id));
      const activeCategoryItems = categoryItems.filter(it => !rejectedReqIds.has(it.requestId));
      const rejectedCategoryItems = categoryItems.filter(it => rejectedReqIds.has(it.requestId));

      const salesRepGroups: Record<string, { requestIds: Set<number>; reservedQty: number; releasedQty: number }> = {};

      for (const item of activeCategoryItems) {
        const req = reqMap[item.requestId];
        if (!req) continue;
        const repId = req.salesRepId || req.createdBy;
        const repName = userMap[repId] || "Unknown";
        if (!salesRepGroups[repName]) salesRepGroups[repName] = { requestIds: new Set(), reservedQty: 0, releasedQty: 0 };
        salesRepGroups[repName].requestIds.add(item.requestId);
        salesRepGroups[repName].reservedQty += item.quantityRequested;
        salesRepGroups[repName].releasedQty += item.quantityReleased || 0;
      }

      const salesReps = Object.entries(salesRepGroups).map(([name, g]) => ({
        name,
        requestCount: g.requestIds.size,
        reservedQty: g.reservedQty,
        releasedQty: g.releasedQty,
        releaseRate: g.reservedQty > 0 ? Math.round((g.releasedQty / g.reservedQty) * 100) : 0,
      })).sort((a, b) => b.reservedQty - a.reservedQty);

      const requestRows = requestsWithCategory.map(req => {
        const repId = req.salesRepId || req.createdBy;
        const items = categoryItems.filter(it => it.requestId === req.id);
        const reservedQty = items.reduce((s, i) => s + i.quantityRequested, 0);
        const releasedQty = items.reduce((s, i) => s + (i.quantityReleased || 0), 0);
        return {
          id: req.id,
          requestNumber: req.requestNumber,
          projectName: req.projectName,
          customerName: req.customerName,
          salesRepName: userMap[repId] || "Unknown",
          department: req.department,
          branchName: branchMap[req.branchId] || "Unknown",
          status: req.status,
          reservedQty,
          releasedQty,
          reservationEndDate: req.reservationEndDate,
          requestDate: req.requestDate,
        };
      }).sort((a, b) => b.requestDate?.localeCompare(a.requestDate ?? "") ?? 0);

      const totalReservedQty = activeCategoryItems.reduce((s, i) => s + i.quantityRequested, 0);
      const totalReleasedQty = activeCategoryItems.reduce((s, i) => s + (i.quantityReleased || 0), 0);
      const totalRejectedQty = rejectedCategoryItems.reduce((s, i) => s + i.quantityRequested, 0);
      const uniqueCustomers = new Set(requestsWithCategory.map(r => r.customerName)).size;
      const uniqueProjects = new Set(requestsWithCategory.map(r => r.projectName)).size;

      res.json({
        categoryName,
        kpis: {
          totalRequests: requestIdsWithCategory.size,
          totalSalesReps: salesReps.length,
          totalReservedQty,
          totalReleasedQty,
          totalRejectedQty,
          releaseRate: totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0,
          uniqueCustomers,
          uniqueProjects,
        },
        salesReps,
        requests: requestRows,
      });
    } catch (err) {
      console.error("[Category Detail Report] Error:", err);
      res.status(500).json({ message: "Failed to generate category detail report" });
    }
  });

  app.get("/api/reports/product-detail/:itemCode", authMiddleware, roleMiddleware("planning", "admin", "sector_head", "category_manager", "branch_manager", "sales_rep"), async (req: Request, res: Response) => {
    try {
      const itemCode = decodeURIComponent(req.params.itemCode as string);
      const { dateFrom, dateTo } = req.query;
      const prodDetailUser = (req as any).user;

      const normalizeCode = (s: string | null | undefined): string => {
        if (!s) return "";
        return s
          .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      };
      const targetCode = normalizeCode(itemCode);

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allProducts = await storage.getProducts();
      const allUsers = await storage.getUsers();
      const allBranchesData = await db.select().from(branches);

      const branchMap: Record<number, string> = {};
      for (const b of allBranchesData) branchMap[b.id] = b.name;

      const userMap: Record<number, string> = {};
      for (const u of allUsers) userMap[u.id] = u.name;

      const product = allProducts.find(p => normalizeCode(p.itemCode) === targetCode);

      let filteredReqs = allReqs;

      if (prodDetailUser?.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(prodDetailUser.id, prodDetailUser.branchId ?? null);
        const salesRepIdsInBranch = new Set(
          allUsers.filter((u: any) => u.role === "sales_rep" && branchIds.includes(u.branchId)).map((u: any) => u.id)
        );
        filteredReqs = filteredReqs.filter(r => salesRepIdsInBranch.has(r.salesRepId) || salesRepIdsInBranch.has(r.createdBy));
      }
      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => r.requestDate >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => r.requestDate <= dateTo);

      const filteredReqIds = new Set(filteredReqs.map(r => r.id));
      const reqMap: Record<number, typeof allReqs[0]> = {};
      for (const r of filteredReqs) reqMap[r.id] = r;

      const productItems = allItems.filter(it => normalizeCode(it.itemCode) === targetCode && filteredReqIds.has(it.requestId));
      const requestIdsWithProduct = new Set(productItems.map(it => it.requestId));
      const requestsWithProduct = filteredReqs.filter(r => requestIdsWithProduct.has(r.id));

      const rejectedReqIds = new Set(requestsWithProduct.filter(r => r.status === "rejected").map(r => r.id));
      const activeProductItems = productItems.filter(it => !rejectedReqIds.has(it.requestId));
      const rejectedProductItems = productItems.filter(it => rejectedReqIds.has(it.requestId));

      const salesRepGroups: Record<string, { requestIds: Set<number>; reservedQty: number; releasedQty: number }> = {};
      for (const item of activeProductItems) {
        const req = reqMap[item.requestId];
        if (!req) continue;
        const repId = req.salesRepId || req.createdBy;
        const repName = userMap[repId] || "Unknown";
        if (!salesRepGroups[repName]) salesRepGroups[repName] = { requestIds: new Set(), reservedQty: 0, releasedQty: 0 };
        salesRepGroups[repName].requestIds.add(item.requestId);
        salesRepGroups[repName].reservedQty += item.quantityRequested;
        salesRepGroups[repName].releasedQty += item.quantityReleased || 0;
      }

      const salesReps = Object.entries(salesRepGroups).map(([name, g]) => ({
        name,
        requestCount: g.requestIds.size,
        reservedQty: g.reservedQty,
        releasedQty: g.releasedQty,
        releaseRate: g.reservedQty > 0 ? Math.round((g.releasedQty / g.reservedQty) * 100) : 0,
      })).sort((a, b) => b.reservedQty - a.reservedQty);

      const requestRows = requestsWithProduct.map(req => {
        const repId = req.salesRepId || req.createdBy;
        const items = productItems.filter(it => it.requestId === req.id);
        const reservedQty = items.reduce((s, i) => s + i.quantityRequested, 0);
        const releasedQty = items.reduce((s, i) => s + (i.quantityReleased || 0), 0);
        return {
          id: req.id,
          requestNumber: req.requestNumber,
          projectName: req.projectName,
          customerName: req.customerName,
          salesRepName: userMap[repId] || "Unknown",
          department: req.department,
          branchName: branchMap[req.branchId] || "Unknown",
          status: req.status,
          reservedQty,
          releasedQty,
          reservationEndDate: req.reservationEndDate,
          requestDate: req.requestDate,
        };
      }).sort((a, b) => b.requestDate?.localeCompare(a.requestDate ?? "") ?? 0);

      const totalReservedQty = activeProductItems.reduce((s, i) => s + i.quantityRequested, 0);
      const totalReleasedQty = activeProductItems.reduce((s, i) => s + (i.quantityReleased || 0), 0);
      const totalRejectedQty = rejectedProductItems.reduce((s, i) => s + i.quantityRequested, 0);
      const uniqueCustomers = new Set(requestsWithProduct.map(r => r.customerName)).size;
      const uniqueProjects = new Set(requestsWithProduct.map(r => r.projectName)).size;

      res.json({
        itemCode,
        description: product?.name ?? itemCode,
        brand: product?.brand ?? null,
        category: product?.category ?? null,
        kpis: {
          totalRequests: requestIdsWithProduct.size,
          totalSalesReps: salesReps.length,
          totalReservedQty,
          totalReleasedQty,
          totalRejectedQty,
          releaseRate: totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0,
          uniqueCustomers,
          uniqueProjects,
        },
        salesReps,
        requests: requestRows,
      });
    } catch (err) {
      console.error("[Product Detail Report] Error:", err);
      res.status(500).json({ message: "Failed to generate product detail report" });
    }
  });

  // Generic dimension detail: customer | branch | brand | department
  app.get("/api/reports/dim-detail/:dimension/:value", authMiddleware, roleMiddleware("planning", "admin", "sector_head", "category_manager", "branch_manager", "sales_rep"), async (req: Request, res: Response) => {
    try {
      const dimension = req.params.dimension as string;
      const value = decodeURIComponent(req.params.value as string);
      const { dateFrom, dateTo } = req.query;
      const dimDetailUser = (req as any).user;

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allUsers = await storage.getUsers();
      const allBranchesData = await db.select().from(branches);

      const branchMap: Record<number, string> = {};
      for (const b of allBranchesData) branchMap[b.id] = b.name;
      const branchNameToId: Record<string, number> = {};
      for (const b of allBranchesData) branchNameToId[b.name] = b.id;

      const userMap: Record<number, string> = {};
      for (const u of allUsers) userMap[u.id] = u.name;

      let filteredReqs = allReqs;

      if (dimDetailUser?.role === "branch_manager") {
        const branchIds = await storage.getUserBranchIds(dimDetailUser.id, dimDetailUser.branchId ?? null);
        const salesRepIdsInBranch = new Set(
          allUsers.filter((u: any) => u.role === "sales_rep" && branchIds.includes(u.branchId)).map((u: any) => u.id)
        );
        filteredReqs = filteredReqs.filter(r => salesRepIdsInBranch.has(r.salesRepId) || salesRepIdsInBranch.has(r.createdBy));
      }
      if (dateFrom && typeof dateFrom === "string") filteredReqs = filteredReqs.filter(r => (r.requestDate ?? "") >= dateFrom);
      if (dateTo && typeof dateTo === "string") filteredReqs = filteredReqs.filter(r => (r.requestDate ?? "") <= dateTo);

      // Filter by dimension
      let matchingReqIds: Set<number>;
      let matchingItems: typeof allItems;

      if (dimension === "brand") {
        const brandItems = allItems.filter(it => it.brand === value);
        matchingReqIds = new Set(brandItems.map(it => it.requestId).filter(id => filteredReqs.some(r => r.id === id)));
        matchingItems = brandItems.filter(it => matchingReqIds.has(it.requestId));
      } else {
        if (dimension === "customer") filteredReqs = filteredReqs.filter(r => r.customerName === value);
        else if (dimension === "branch") filteredReqs = filteredReqs.filter(r => branchMap[r.branchId] === value);
        else if (dimension === "department") filteredReqs = filteredReqs.filter(r => r.department === value);
        else if (dimension === "project") filteredReqs = filteredReqs.filter(r => r.projectName === value);
        matchingReqIds = new Set(filteredReqs.map(r => r.id));
        matchingItems = allItems.filter(it => matchingReqIds.has(it.requestId));
      }

      const matchingReqs = allReqs.filter(r => matchingReqIds.has(r.id));
      const reqMap: Record<number, typeof allReqs[0]> = {};
      for (const r of matchingReqs) reqMap[r.id] = r;

      const rejectedReqIds = new Set(matchingReqs.filter(r => r.status === "rejected").map(r => r.id));
      const activeMatchingItems = matchingItems.filter(it => !rejectedReqIds.has(it.requestId));
      const rejectedMatchingItems = matchingItems.filter(it => rejectedReqIds.has(it.requestId));

      // Sales rep grouping (active items only)
      const salesRepGroups: Record<string, { requestIds: Set<number>; reservedQty: number; releasedQty: number }> = {};
      for (const item of activeMatchingItems) {
        const req = reqMap[item.requestId];
        if (!req) continue;
        const repId = req.salesRepId || req.createdBy;
        const repName = userMap[repId] || "Unknown";
        if (!salesRepGroups[repName]) salesRepGroups[repName] = { requestIds: new Set(), reservedQty: 0, releasedQty: 0 };
        salesRepGroups[repName].requestIds.add(item.requestId);
        salesRepGroups[repName].reservedQty += item.quantityRequested;
        salesRepGroups[repName].releasedQty += item.quantityReleased || 0;
      }

      const salesReps = Object.entries(salesRepGroups).map(([name, g]) => ({
        name,
        requestCount: g.requestIds.size,
        reservedQty: g.reservedQty,
        releasedQty: g.releasedQty,
        releaseRate: g.reservedQty > 0 ? Math.round((g.releasedQty / g.reservedQty) * 100) : 0,
      })).sort((a, b) => b.reservedQty - a.reservedQty);

      const requestRows = matchingReqs.map(req => {
        const repId = req.salesRepId || req.createdBy;
        const items = matchingItems.filter(it => it.requestId === req.id);
        const reservedQty = items.reduce((s, i) => s + i.quantityRequested, 0);
        const releasedQty = items.reduce((s, i) => s + (i.quantityReleased || 0), 0);
        return {
          id: req.id,
          requestNumber: req.requestNumber,
          projectName: req.projectName,
          customerName: req.customerName,
          salesRepName: userMap[repId] || "Unknown",
          department: req.department,
          branchName: branchMap[req.branchId] || "Unknown",
          status: req.status,
          reservedQty,
          releasedQty,
          reservationEndDate: req.reservationEndDate,
          requestDate: req.requestDate,
        };
      }).sort((a, b) => (b.requestDate ?? "").localeCompare(a.requestDate ?? ""));

      const totalReservedQty = activeMatchingItems.reduce((s, i) => s + i.quantityRequested, 0);
      const totalReleasedQty = activeMatchingItems.reduce((s, i) => s + (i.quantityReleased || 0), 0);
      const totalRejectedQty = rejectedMatchingItems.reduce((s, i) => s + i.quantityRequested, 0);
      const uniqueCustomers = new Set(matchingReqs.map(r => r.customerName)).size;
      const uniqueProjects = new Set(matchingReqs.map(r => r.projectName)).size;

      res.json({
        dimension,
        value,
        kpis: {
          totalRequests: matchingReqIds.size,
          totalSalesReps: salesReps.length,
          totalReservedQty,
          totalReleasedQty,
          totalRejectedQty,
          releaseRate: totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0,
          uniqueCustomers,
          uniqueProjects,
        },
        salesReps,
        requests: requestRows,
      });
    } catch (err) {
      console.error("[Dim Detail Report] Error:", err);
      res.status(500).json({ message: "Failed to generate dimension detail report" });
    }
  });

  app.get("/api/customers", authMiddleware, roleMiddleware("planning", "admin", "sector_head"), async (req: Request, res: Response) => {
    try {
      const { search, date_from, date_to, sort_by = "total_requests", sort_direction = "desc" } = req.query as Record<string, string>;

      const conditions: any[] = [];
      if (search) {
        conditions.push(ilike(requests.customerName, `%${search}%`));
      }
      if (date_from) {
        conditions.push(sql`${requests.createdAt} >= ${date_from}::timestamp`);
      }
      if (date_to) {
        conditions.push(sql`${requests.createdAt} <= ${date_to}::timestamp + interval '1 day'`);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const sortColumnMap: Record<string, any> = {
        customer_name: sql`LOWER(TRIM(${requests.customerName}))`,
        total_requests: sql`COUNT(DISTINCT ${requests.id})`,
        total_reserved: sql`COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0)`,
        total_released: sql`COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released), 0)`,
        total_profit: sql`COALESCE(SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released), 0)`,
        last_activity: sql`MAX(${requests.createdAt})`,
      };

      const sortCol = sortColumnMap[sort_by] || sortColumnMap.total_requests;
      const orderDir = sort_direction === "asc" ? sql`ASC` : sql`DESC`;

      const result = await db.execute(sql`
        SELECT
          TRIM(${requests.customerName}) as customer_name,
          COUNT(DISTINCT ${requests.id})::int as total_requests,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0)::numeric as total_reserved,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released), 0)::numeric as total_released,
          COALESCE(SUM(CAST(ri.cost_price AS numeric) * ri.quantity_requested), 0)::numeric as total_reserved_cost,
          COALESCE(SUM(CAST(ri.cost_price AS numeric) * ri.quantity_released), 0)::numeric as total_released_cost,
          COALESCE(SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released), 0)::numeric as total_profit,
          CASE
            WHEN COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0) > 0
            THEN ROUND(COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released), 0) * 100.0 / NULLIF(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0), 1)
            ELSE 0
          END::numeric as release_ratio,
          MAX(${requests.createdAt}) as last_activity
        FROM ${requests}
        LEFT JOIN request_items ri ON ri.request_id = ${requests.id}
        ${whereClause ? sql`WHERE ${whereClause}` : sql``}
        GROUP BY LOWER(TRIM(${requests.customerName})), TRIM(${requests.customerName})
        HAVING TRIM(${requests.customerName}) != ''
        ORDER BY ${sort_by === "customer_name" ? sql`LOWER(TRIM(${requests.customerName}))` : sort_by === "total_requests" ? sql`count(*)` : sort_by === "total_reserved" ? sql`SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested)` : sort_by === "total_released" ? sql`SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released)` : sort_by === "total_profit" ? sql`SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released)` : sort_by === "last_activity" ? sql`MAX(${requests.createdAt})` : sql`count(*)`} ${sort_direction === "asc" ? sql`ASC` : sql`DESC`}
      `);

      const customers = (result.rows || []).map((row: any) => ({
        customerName: row.customer_name,
        totalRequests: Number(row.total_requests),
        totalReserved: Number(row.total_reserved),
        totalReleased: Number(row.total_released),
        totalReservedCost: Number(row.total_reserved_cost),
        totalReleasedCost: Number(row.total_released_cost),
        totalProfit: Number(row.total_profit),
        releaseRatio: Number(row.release_ratio),
        lastActivity: row.last_activity,
      }));

      res.json(customers);
    } catch (err) {
      console.error("Error fetching customers:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/customers/:name", authMiddleware, roleMiddleware("planning", "admin", "sector_head"), async (req: Request, res: Response) => {
    try {
      const customerName = decodeURIComponent(String(req.params.name));
      const { date_from, date_to, sort_by = "created_at", sort_direction = "desc" } = req.query as Record<string, string>;

      let dateConditions = sql``;
      if (date_from) {
        dateConditions = sql`${dateConditions} AND r.created_at >= ${date_from}::timestamp`;
      }
      if (date_to) {
        dateConditions = sql`${dateConditions} AND r.created_at <= ${date_to}::timestamp + interval '1 day'`;
      }

      const result = await db.execute(sql`
        SELECT
          r.id,
          r.request_number,
          r.status,
          r.created_at,
          r.customer_name,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0)::numeric as reserved_value,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released), 0)::numeric as released_value,
          COALESCE(SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released), 0)::numeric as profit
        FROM ${requests} r
        LEFT JOIN request_items ri ON ri.request_id = r.id
        WHERE LOWER(TRIM(r.customer_name)) = LOWER(TRIM(${customerName}))
        ${dateConditions}
        GROUP BY r.id, r.request_number, r.status, r.created_at, r.customer_name
        ORDER BY ${sort_by === "request_number" ? sql`r.request_number` : sort_by === "status" ? sql`r.status` : sort_by === "reserved_value" ? sql`SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested)` : sort_by === "released_value" ? sql`SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released)` : sort_by === "profit" ? sql`SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released)` : sql`r.created_at`} ${sort_direction === "asc" ? sql`ASC` : sql`DESC`}
      `);

      const reqs = (result.rows || []).map((row: any) => ({
        id: row.id,
        requestNumber: row.request_number,
        status: row.status,
        createdAt: row.created_at,
        reservedValue: Number(row.reserved_value),
        releasedValue: Number(row.released_value),
        profit: Number(row.profit),
      }));

      const summary = {
        customerName,
        totalRequests: reqs.length,
        totalReserved: reqs.reduce((sum: number, r: any) => sum + r.reservedValue, 0),
        totalReleased: reqs.reduce((sum: number, r: any) => sum + r.releasedValue, 0),
        totalProfit: reqs.reduce((sum: number, r: any) => sum + r.profit, 0),
        releaseRatio: 0,
      };
      if (summary.totalReserved > 0) {
        summary.releaseRatio = Math.round((summary.totalReleased / summary.totalReserved) * 1000) / 10;
      }

      res.json({ summary, requests: reqs });
    } catch (err) {
      console.error("Error fetching customer details:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/projects", authMiddleware, roleMiddleware("planning", "admin", "sector_head"), async (req: Request, res: Response) => {
    try {
      const { search, date_from, date_to, sort_by = "total_requests", sort_direction = "desc" } = req.query as Record<string, string>;

      const conditions: any[] = [];
      if (search) {
        conditions.push(ilike(requests.projectName, `%${search}%`));
      }
      if (date_from) {
        conditions.push(sql`${requests.createdAt} >= ${date_from}::timestamp`);
      }
      if (date_to) {
        conditions.push(sql`${requests.createdAt} <= ${date_to}::timestamp + interval '1 day'`);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const result = await db.execute(sql`
        SELECT
          TRIM(${requests.projectName}) as project_name,
          COUNT(DISTINCT ${requests.id})::int as total_requests,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0)::numeric as total_reserved,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released), 0)::numeric as total_released,
          COALESCE(SUM(CAST(ri.cost_price AS numeric) * ri.quantity_requested), 0)::numeric as total_reserved_cost,
          COALESCE(SUM(CAST(ri.cost_price AS numeric) * ri.quantity_released), 0)::numeric as total_released_cost,
          COALESCE(SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released), 0)::numeric as total_profit,
          CASE
            WHEN COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0) > 0
            THEN ROUND(COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released), 0) * 100.0 / NULLIF(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0), 1)
            ELSE 0
          END::numeric as release_ratio,
          MAX(${requests.createdAt}) as last_activity
        FROM ${requests}
        LEFT JOIN request_items ri ON ri.request_id = ${requests.id}
        ${whereClause ? sql`WHERE ${whereClause}` : sql``}
        GROUP BY LOWER(TRIM(${requests.projectName})), TRIM(${requests.projectName})
        HAVING TRIM(${requests.projectName}) != '' AND TRIM(${requests.projectName}) IS NOT NULL
        ORDER BY ${sort_by === "project_name" ? sql`LOWER(TRIM(${requests.projectName}))` : sort_by === "total_requests" ? sql`COUNT(DISTINCT ${requests.id})` : sort_by === "total_reserved" ? sql`SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested)` : sort_by === "total_released" ? sql`SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released)` : sort_by === "total_profit" ? sql`SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released)` : sort_by === "last_activity" ? sql`MAX(${requests.createdAt})` : sql`COUNT(DISTINCT ${requests.id})`} ${sort_direction === "asc" ? sql`ASC` : sql`DESC`}
      `);

      const projects = (result.rows || []).map((row: any) => ({
        projectName: row.project_name,
        totalRequests: Number(row.total_requests),
        totalReserved: Number(row.total_reserved),
        totalReleased: Number(row.total_released),
        totalReservedCost: Number(row.total_reserved_cost),
        totalReleasedCost: Number(row.total_released_cost),
        totalProfit: Number(row.total_profit),
        releaseRatio: Number(row.release_ratio),
        lastActivity: row.last_activity,
      }));

      res.json(projects);
    } catch (err) {
      console.error("Error fetching projects:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/projects/:name", authMiddleware, roleMiddleware("planning", "admin", "sector_head"), async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(String(req.params.name));
      const { date_from, date_to } = req.query as Record<string, string>;

      let dateConditions = sql``;
      if (date_from) {
        dateConditions = sql`${dateConditions} AND r.created_at >= ${date_from}::timestamp`;
      }
      if (date_to) {
        dateConditions = sql`${dateConditions} AND r.created_at <= ${date_to}::timestamp + interval '1 day'`;
      }

      const result = await db.execute(sql`
        SELECT
          r.id,
          r.request_number,
          r.status,
          r.created_at,
          r.project_name,
          r.customer_name,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_requested), 0)::numeric as reserved_value,
          COALESCE(SUM(CAST(ri.selling_price AS numeric) * ri.quantity_released), 0)::numeric as released_value,
          COALESCE(SUM((CAST(ri.selling_price AS numeric) - CAST(ri.cost_price AS numeric)) * ri.quantity_released), 0)::numeric as profit
        FROM ${requests} r
        LEFT JOIN request_items ri ON ri.request_id = r.id
        WHERE LOWER(TRIM(r.project_name)) = LOWER(TRIM(${projectName}))
        ${dateConditions}
        GROUP BY r.id, r.request_number, r.status, r.created_at, r.project_name, r.customer_name
        ORDER BY r.created_at DESC
      `);

      const reqs = (result.rows || []).map((row: any) => ({
        id: row.id,
        requestNumber: row.request_number,
        status: row.status,
        createdAt: row.created_at,
        customerName: row.customer_name,
        reservedValue: Number(row.reserved_value),
        releasedValue: Number(row.released_value),
        profit: Number(row.profit),
      }));

      const summary = {
        projectName,
        totalRequests: reqs.length,
        totalReserved: reqs.reduce((sum: number, r: any) => sum + r.reservedValue, 0),
        totalReleased: reqs.reduce((sum: number, r: any) => sum + r.releasedValue, 0),
        totalProfit: reqs.reduce((sum: number, r: any) => sum + r.profit, 0),
        releaseRatio: 0,
      };
      if (summary.totalReserved > 0) {
        summary.releaseRatio = Math.round((summary.totalReleased / summary.totalReserved) * 1000) / 10;
      }

      res.json({ summary, requests: reqs });
    } catch (err) {
      console.error("Error fetching project details:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/projects/:name/reports/:dimension", authMiddleware, roleMiddleware("planning", "admin", "sector_head"), async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(String(req.params.name));
      const dimension = String(req.params.dimension);
      const validDimensions = ["customer", "product", "brand", "branch", "department", "category"];
      if (!validDimensions.includes(dimension)) {
        return res.status(400).json({ message: "Invalid dimension" });
      }

      const allReqs = await db.select().from(requests);
      const allItems = await db.select().from(requestItems);
      const allBranchesData = await db.select().from(branches);
      const allProducts = await storage.getProducts();

      const branchMap: Record<number, string> = {};
      for (const b of allBranchesData) branchMap[b.id] = b.name;

      const productMap: Record<string, { category: string }> = {};
      for (const p of allProducts) {
        productMap[p.itemCode] = { category: p.category };
      }

      const projectReqs = allReqs.filter(r =>
        r.projectName && r.projectName.trim().toLowerCase() === projectName.trim().toLowerCase()
      );
      const projectReqIds = new Set(projectReqs.map(r => r.id));
      const projectItems = allItems.filter(it => projectReqIds.has(it.requestId));

      const reqMap: Record<number, typeof allReqs[0]> = {};
      for (const r of projectReqs) reqMap[r.id] = r;

      const groups: Record<string, { requestIds: Set<number>; reservedQty: number; releasedQty: number; reservedValue: number; releasedValue: number }> = {};

      for (const item of projectItems) {
        const req = reqMap[item.requestId];
        if (!req) continue;

        let key = "Unknown";
        switch (dimension) {
          case "customer": key = req.customerName || "Unknown"; break;
          case "product": key = item.itemDescription || item.productName || item.itemCode || "Unknown"; break;
          case "brand": key = item.brand || "Unknown"; break;
          case "branch": key = branchMap[req.branchId] || "Unknown"; break;
          case "department": key = req.department || "Unknown"; break;
          case "category": {
            const prod = productMap[item.itemCode];
            key = prod?.category || "Unknown";
            break;
          }
        }

        if (!groups[key]) groups[key] = { requestIds: new Set(), reservedQty: 0, releasedQty: 0, reservedValue: 0, releasedValue: 0 };
        const g = groups[key];
        g.requestIds.add(item.requestId);
        g.reservedQty += item.quantityRequested;
        g.releasedQty += item.quantityReleased || 0;
        const sp = Number(item.sellingPrice) || 0;
        g.reservedValue += sp * item.quantityRequested;
        g.releasedValue += sp * (item.quantityReleased || 0);
      }

      const rows = Object.entries(groups).map(([name, g]) => ({
        name,
        requestCount: g.requestIds.size,
        reservedQty: g.reservedQty,
        releasedQty: g.releasedQty,
        reservedValue: Math.round(g.reservedValue),
        releasedValue: Math.round(g.releasedValue),
        releaseRate: g.reservedQty > 0 ? Math.round((g.releasedQty / g.reservedQty) * 100) : 0,
      })).sort((a, b) => b.reservedValue - a.reservedValue);

      const totalReservedQty = rows.reduce((s, r) => s + r.reservedQty, 0);
      const totalReleasedQty = rows.reduce((s, r) => s + r.releasedQty, 0);

      res.json({
        kpis: {
          totalRequests: new Set(projectItems.map(i => i.requestId)).size,
          totalReservedQty,
          totalReleasedQty,
          releaseRate: totalReservedQty > 0 ? Math.round((totalReleasedQty / totalReservedQty) * 100) : 0,
          totalReservedValue: rows.reduce((s, r) => s + r.reservedValue, 0),
          totalReleasedValue: rows.reduce((s, r) => s + r.releasedValue, 0),
        },
        rows,
        chart: rows.slice(0, 10).map(r => ({ name: r.name.length > 20 ? r.name.substring(0, 17) + "..." : r.name, reserved: r.reservedValue, released: r.releasedValue })),
      });
    } catch (err) {
      console.error(`Error fetching project report:`, err);
      res.status(500).json({ message: "Failed to generate project report" });
    }
  });

  return httpServer;
}
