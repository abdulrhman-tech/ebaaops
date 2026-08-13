import { eq, desc, and, sql, inArray, or, ilike, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  users, branches, requests, requestItems, approvals,
  stockReleases, stockReleaseItems, notifications, auditLogs,
  adminDepartments, adminWarehouses, products, requestExtensions,
  departmentBranches, userBranches, productCategories,
  type User, type Branch, type Request, type RequestItem,
  type Approval, type StockRelease, type StockReleaseItem,
  type Notification, type AuditLog, type InsertUser,
  type AdminDepartment, type AdminWarehouse,
  type Product, type InsertProduct,
  type RequestExtension, type ProductCategory,
} from "@shared/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
pool.on("error", (err) => {
  console.error("Unexpected pool error:", err.message);
});
export const db = drizzle(pool);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsers(): Promise<(User & { branch?: Branch })[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;

  getBranch(id: number): Promise<Branch | undefined>;
  getBranches(): Promise<Branch[]>;
  createBranch(name: string): Promise<Branch>;
  deleteBranch(id: number): Promise<void>;

  getDepartments(): Promise<(AdminDepartment & { branchIds: number[] })[]>;
  createDepartment(name: string, branchIds?: number[]): Promise<AdminDepartment>;
  updateDepartment(id: number, data: { name?: string; branchIds?: number[] }): Promise<AdminDepartment>;
  deleteDepartment(id: number): Promise<void>;
  getDepartmentBranches(departmentId: number): Promise<number[]>;
  setDepartmentBranches(departmentId: number, branchIds: number[]): Promise<void>;

  getWarehouses(): Promise<AdminWarehouse[]>;
  createWarehouse(name: string, location?: string): Promise<AdminWarehouse>;
  updateWarehouse(id: number, data: { name?: string; location?: string }): Promise<AdminWarehouse>;
  deleteWarehouse(id: number): Promise<void>;

  getUserBranchIds(userId: number, fallbackBranchId: number | null): Promise<number[]>;
  setUserBranches(userId: number, branchIds: number[]): Promise<void>;
  getAllUserBranches(): Promise<{userId: number, branchId: number}[]>;

  getRequests(userId: number, role: string, branchId: number | null, branchIds?: number[], productCategoryId?: number | null): Promise<any[]>;
  getRequestById(id: number): Promise<any>;
  createRequest(data: {
    createdBy: number;
    salesRepId?: number;
    branchId: number;
    notes?: string;
    requestDate: string;
    department: string;
    customerName: string;
    customerAccountNumber: string;
    projectName: string;
    reservationDuration?: string;
    reservationEndDate?: string;
    advancePayment?: number;
    purchaseOrderFile?: string;
    accountStatementFile?: string;
    productCategoryId?: number;
    salesChannel?: string | null;
  }): Promise<Request>;
  updateRequestStatus(id: number, status: string): Promise<void>;
  updateRequest(id: number, data: Partial<{
    notes: string;
    department: string;
    customerName: string;
    customerAccountNumber: string;
    projectName: string;
    reservationDuration: string;
    reservationEndDate: string;
    advancePayment: number;
    salesRepId: number;
    purchaseOrderFile: string;
    accountStatementFile: string;
    sapReservationNumber: string | null;
  }>): Promise<void>;
  updateRequestEndDate(id: number, endDate: string): Promise<void>;
  deleteRequestItems(requestId: number): Promise<void>;

  createRequestItem(data: {
    requestId: number;
    itemCode: string;
    itemDescription: string;
    brand: string;
    quantityRequested: number;
    warehouse: string;
    sellingPrice?: string | null;
    costPrice?: string | null;
    quantityChangedFrom?: number | null;
    isNewItem?: boolean;
  }): Promise<RequestItem>;
  getRequestItems(requestId: number): Promise<RequestItem[]>;
  updateRequestItemRelease(id: number, additionalQty: number): Promise<RequestItem>;

  createApproval(data: { requestId: number; role: string; action: string; type?: string; notes?: string; userId: number }): Promise<Approval>;
  getApprovalsByRequest(requestId: number): Promise<(Approval & { user: User })[]>;

  createStockRelease(data: { requestId: number; createdBy: number; releaseType: string; branchId?: number | null; notes?: string }): Promise<StockRelease>;
  createStockReleaseItem(stockReleaseId: number, requestItemId: number, qty: number): Promise<StockReleaseItem>;
  getStockReleasesByRequest(requestId: number): Promise<any[]>;
  getAllStockReleases(): Promise<any[]>;
  getStockReleaseById(id: number): Promise<any>;
  updateStockReleaseStatus(id: number, status: string): Promise<void>;

  createNotification(userId: number, title: string, message: string, link?: string): Promise<Notification>;
  getNotifications(userId: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  markNotificationRead(id: number): Promise<void>;
  markAllNotificationsRead(userId: number): Promise<void>;

  createAuditLog(data: { userId: number; action: string; entity: string; entityId: number; oldData?: any; newData?: any }): Promise<AuditLog>;
  getAuditLogsByEntity(entity: string, entityId: number): Promise<(AuditLog & { user: User })[]>;
  getAllAuditLogs(): Promise<(AuditLog & { user: User })[]>;

  getDashboardStats(userId: number, role: string, branchId: number | null, branchIds?: number[], productCategoryId?: number | null): Promise<any>;

  getNextRequestNumber(): Promise<string>;
  deleteRequest(id: number): Promise<void>;

  getProducts(): Promise<Product[]>;
  getProductsPaginated(params: { page: number; limit: number; search?: string }): Promise<{ data: Product[]; total: number; page: number; totalPages: number }>;
  getProductByCode(itemCode: string): Promise<Product | undefined>;
  getProductById(id: number): Promise<Product | undefined>;
  createProduct(data: InsertProduct): Promise<Product>;
  updateProduct(id: number, data: Partial<InsertProduct>): Promise<Product>;
  deleteProduct(id: number): Promise<void>;
  bulkUpsertProducts(items: InsertProduct[]): Promise<{ created: number; updated: number }>;

  createRequestExtension(data: { requestId: number; requestedBy: number; requestedDays: number; previousExpiryDate: string; newExpiryDate: string; totalDaysFromCreation: number; status: string; notes?: string }): Promise<RequestExtension>;
  getExtensionsByRequest(requestId: number): Promise<(RequestExtension & { requestedByUser?: User })[]>;
  getExtensionById(id: number): Promise<RequestExtension | undefined>;
  updateExtensionStatus(id: number, status: string, rejectionReason?: string): Promise<void>;
  incrementExtensionCount(requestId: number): Promise<void>;

  getProductCategories(): Promise<ProductCategory[]>;
  createProductCategory(name: string): Promise<ProductCategory>;
  updateProductCategory(id: number, name: string): Promise<ProductCategory>;
  deleteProductCategory(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUsers(): Promise<(User & { branch?: Branch })[]> {
    const allUsers = await db.select().from(users).orderBy(users.name);
    const allBranches = await db.select().from(branches);
    const branchMap = new Map(allBranches.map(b => [b.id, b]));
    return allUsers.map(u => ({
      ...u,
      branch: u.branchId ? branchMap.get(u.branchId) : undefined,
    }));
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data as any).returning();
    return user;
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User> {
    const [updated] = await db.update(users).set(data as any).where(eq(users.id, id)).returning();
    if (!updated) throw new Error("User not found");
    return updated;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getBranch(id: number): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.id, id));
    return branch;
  }

  async getBranches(): Promise<Branch[]> {
    return db.select().from(branches);
  }

  async createBranch(name: string): Promise<Branch> {
    const [branch] = await db.insert(branches).values({ name }).returning();
    return branch;
  }

  async deleteBranch(id: number): Promise<void> {
    await db.delete(branches).where(eq(branches.id, id));
  }

  async getDepartments(): Promise<(AdminDepartment & { branchIds: number[] })[]> {
    const depts = await db.select().from(adminDepartments).orderBy(adminDepartments.name);
    const allLinks = await db.select().from(departmentBranches);
    return depts.map(d => ({
      ...d,
      branchIds: allLinks.filter(l => l.departmentId === d.id).map(l => l.branchId),
    }));
  }

  async createDepartment(name: string, branchIds?: number[]): Promise<AdminDepartment> {
    const [dept] = await db.insert(adminDepartments).values({ name }).returning();
    if (branchIds && branchIds.length > 0) {
      await this.setDepartmentBranches(dept.id, branchIds);
    }
    return dept;
  }

  async updateDepartment(id: number, data: { name?: string; branchIds?: number[] }): Promise<AdminDepartment> {
    let dept: AdminDepartment;
    if (data.name !== undefined) {
      const [updated] = await db.update(adminDepartments).set({ name: data.name }).where(eq(adminDepartments.id, id)).returning();
      dept = updated;
    } else {
      const [existing] = await db.select().from(adminDepartments).where(eq(adminDepartments.id, id));
      if (!existing) throw new Error("Department not found");
      dept = existing;
    }
    if (data.branchIds !== undefined) {
      await this.setDepartmentBranches(id, data.branchIds);
    }
    return dept;
  }

  async deleteDepartment(id: number): Promise<void> {
    await db.delete(departmentBranches).where(eq(departmentBranches.departmentId, id));
    await db.delete(adminDepartments).where(eq(adminDepartments.id, id));
  }

  async getDepartmentBranches(departmentId: number): Promise<number[]> {
    const links = await db.select().from(departmentBranches).where(eq(departmentBranches.departmentId, departmentId));
    return links.map(l => l.branchId);
  }

  async setDepartmentBranches(departmentId: number, branchIds: number[]): Promise<void> {
    await db.delete(departmentBranches).where(eq(departmentBranches.departmentId, departmentId));
    if (branchIds.length > 0) {
      await db.insert(departmentBranches).values(branchIds.map(branchId => ({ departmentId, branchId })));
    }
  }

  async getUserBranchIds(userId: number, fallbackBranchId: number | null): Promise<number[]> {
    const links = await db.select().from(userBranches).where(eq(userBranches.userId, userId));
    if (links.length > 0) {
      return links.map(l => l.branchId);
    }
    return fallbackBranchId ? [fallbackBranchId] : [];
  }

  async setUserBranches(userId: number, branchIds: number[]): Promise<void> {
    await db.delete(userBranches).where(eq(userBranches.userId, userId));
    if (branchIds.length > 0) {
      await db.insert(userBranches).values(branchIds.map(branchId => ({ userId, branchId })));
    }
  }

  async getAllUserBranches(): Promise<{userId: number, branchId: number}[]> {
    return db.select({ userId: userBranches.userId, branchId: userBranches.branchId }).from(userBranches);
  }

  async getWarehouses(): Promise<AdminWarehouse[]> {
    return db.select().from(adminWarehouses).orderBy(adminWarehouses.name);
  }

  async createWarehouse(name: string, location?: string): Promise<AdminWarehouse> {
    const [wh] = await db.insert(adminWarehouses).values({ name, location: location || "" }).returning();
    return wh;
  }

  async updateWarehouse(id: number, data: { name?: string; location?: string }): Promise<AdminWarehouse> {
    const [wh] = await db.update(adminWarehouses).set(data).where(eq(adminWarehouses.id, id)).returning();
    return wh;
  }

  async deleteWarehouse(id: number): Promise<void> {
    await db.delete(adminWarehouses).where(eq(adminWarehouses.id, id));
  }

  async getRequests(userId: number, role: string, branchId: number | null, branchIds?: number[], productCategoryId?: number | null): Promise<any[]> {
    let allRequests = await db.select().from(requests).orderBy(desc(requests.createdAt));

    if (role === "sales_rep") {
      allRequests = allRequests.filter(r => r.createdBy === userId || r.salesRepId === userId);
    } else if (role === "branch_manager") {
      const effectiveBranchIds = branchIds && branchIds.length > 0 ? branchIds : (branchId ? [branchId] : []);
      allRequests = allRequests.filter(r => effectiveBranchIds.includes(r.branchId));
    } else if (role === "category_manager" && productCategoryId) {
      allRequests = allRequests.filter(r => r.productCategoryId === productCategoryId);
    } else if (role === "admin" || role === "planning" || role === "sector_head") {
      // These roles see all requests
    }

    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allItems = await db.select().from(requestItems);

    return allRequests.map(r => ({
      ...r,
      creator: userMap.get(r.createdBy),
      salesRep: r.salesRepId ? userMap.get(r.salesRepId) : undefined,
      items: allItems.filter(i => i.requestId === r.id),
    }));
  }

  async getRequestById(id: number): Promise<any> {
    const [req] = await db.select().from(requests).where(eq(requests.id, id));
    if (!req) return null;

    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    const items = await db.select().from(requestItems).where(eq(requestItems.requestId, id));
    const reqApprovals = await db.select().from(approvals).where(eq(approvals.requestId, id)).orderBy(approvals.createdAt);
    const releases = await db.select().from(stockReleases).where(eq(stockReleases.requestId, id)).orderBy(desc(stockReleases.createdAt));

    const releaseIds = releases.map(r => r.id);
    let releaseItemsList: StockReleaseItem[] = [];
    if (releaseIds.length > 0) {
      releaseItemsList = await db.select().from(stockReleaseItems).where(inArray(stockReleaseItems.stockReleaseId, releaseIds));
    }

    const itemMap = new Map(items.map(i => [i.id, i]));

    const logs = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.entity, "request"), eq(auditLogs.entityId, id)))
      .orderBy(desc(auditLogs.createdAt));

    const extensions = await db.select().from(requestExtensions)
      .where(eq(requestExtensions.requestId, id))
      .orderBy(desc(requestExtensions.createdAt));

    return {
      ...req,
      creator: userMap.get(req.createdBy),
      salesRep: req.salesRepId ? userMap.get(req.salesRepId) : undefined,
      items,
      approvals: reqApprovals.map(a => ({ ...a, user: userMap.get(a.userId) })),
      stockReleases: releases.map(r => ({
        ...r,
        creator: userMap.get(r.createdBy),
        items: releaseItemsList
          .filter(ri => ri.stockReleaseId === r.id)
          .map(ri => ({ ...ri, requestItem: itemMap.get(ri.requestItemId) })),
      })),
      extensions: extensions.map(e => ({ ...e, requestedByUser: userMap.get(e.requestedBy) })),
      auditLogs: logs.map(l => ({ ...l, user: userMap.get(l.userId) })),
    };
  }

  async createRequest(data: {
    createdBy: number;
    salesRepId?: number;
    branchId: number;
    notes?: string;
    requestDate: string;
    department: string;
    customerName: string;
    customerAccountNumber: string;
    projectName: string;
    reservationDuration?: string;
    reservationEndDate?: string;
    advancePayment?: number;
    purchaseOrderFile?: string;
    accountStatementFile?: string;
    productCategoryId?: number;
    salesChannel?: string | null;
  }): Promise<Request> {
    const requestNumber = await this.getNextRequestNumber();
    const [req] = await db.insert(requests).values({
      requestNumber,
      createdBy: data.createdBy,
      salesRepId: data.salesRepId,
      branchId: data.branchId,
      notes: data.notes,
      requestDate: data.requestDate,
      department: data.department,
      customerName: data.customerName,
      customerAccountNumber: data.customerAccountNumber,
      projectName: data.projectName,
      reservationDuration: data.reservationDuration,
      reservationEndDate: data.reservationEndDate,
      advancePayment: data.advancePayment?.toString(),
      purchaseOrderFile: data.purchaseOrderFile,
      accountStatementFile: data.accountStatementFile,
      productCategoryId: data.productCategoryId,
      salesChannel: data.salesChannel,
      status: "submitted",
    }).returning();
    return req;
  }

  async updateRequestStatus(id: number, status: string): Promise<void> {
    await db.update(requests).set({ status: status as any, updatedAt: new Date() }).where(eq(requests.id, id));
  }

  async updateRequest(id: number, data: Partial<{
    notes: string;
    department: string;
    customerName: string;
    customerAccountNumber: string;
    projectName: string;
    requestDate: string;
    reservationDuration: string;
    reservationEndDate: string;
    advancePayment: number;
    salesRepId: number;
    purchaseOrderFile: string;
    accountStatementFile: string;
    sapReservationNumber: string | null;
  }>): Promise<void> {
    const setData: any = { updatedAt: new Date() };
    if (data.notes !== undefined) setData.notes = data.notes;
    if (data.department !== undefined) setData.department = data.department;
    if (data.customerName !== undefined) setData.customerName = data.customerName;
    if (data.customerAccountNumber !== undefined) setData.customerAccountNumber = data.customerAccountNumber;
    if (data.projectName !== undefined) setData.projectName = data.projectName;
    if (data.requestDate !== undefined) setData.requestDate = data.requestDate;
    if (data.reservationDuration !== undefined) setData.reservationDuration = data.reservationDuration;
    if (data.reservationEndDate !== undefined) setData.reservationEndDate = data.reservationEndDate;
    if (data.advancePayment !== undefined) setData.advancePayment = data.advancePayment?.toString();
    if (data.salesRepId !== undefined) setData.salesRepId = data.salesRepId;
    if (data.purchaseOrderFile !== undefined) setData.purchaseOrderFile = data.purchaseOrderFile;
    if (data.accountStatementFile !== undefined) setData.accountStatementFile = data.accountStatementFile;
    if (data.sapReservationNumber !== undefined) setData.sapReservationNumber = data.sapReservationNumber;
    await db.update(requests).set(setData).where(eq(requests.id, id));
  }

  async updateRequestEndDate(id: number, endDate: string): Promise<void> {
    await db.update(requests)
      .set({ reservationEndDate: endDate, updatedAt: new Date() })
      .where(eq(requests.id, id));
  }

  async deleteRequestItems(requestId: number): Promise<void> {
    await db.delete(requestItems).where(eq(requestItems.requestId, requestId));
  }

  async createRequestItem(data: {
    requestId: number;
    itemCode: string;
    itemDescription: string;
    brand: string;
    quantityRequested: number;
    warehouse: string;
    sellingPrice?: string | null;
    costPrice?: string | null;
    quantityChangedFrom?: number | null;
    isNewItem?: boolean;
  }): Promise<RequestItem> {
    const [item] = await db.insert(requestItems).values({
      requestId: data.requestId,
      productName: `${data.itemCode} - ${data.itemDescription}`,
      itemCode: data.itemCode,
      itemDescription: data.itemDescription,
      brand: data.brand,
      quantityRequested: data.quantityRequested,
      warehouse: data.warehouse,
      sellingPrice: data.sellingPrice || null,
      costPrice: data.costPrice || null,
      quantityReleased: 0,
      status: "pending",
      quantityChangedFrom: data.quantityChangedFrom ?? null,
      isNewItem: data.isNewItem ?? false,
    }).returning();
    return item;
  }

  async getRequestItems(requestId: number): Promise<RequestItem[]> {
    return db.select().from(requestItems).where(eq(requestItems.requestId, requestId));
  }

  async updateRequestItemRelease(id: number, additionalQty: number): Promise<RequestItem> {
    const [item] = await db.select().from(requestItems).where(eq(requestItems.id, id));
    if (!item) throw new Error("Item not found");
    const newReleased = item.quantityReleased + additionalQty;
    const newStatus = newReleased >= item.quantityRequested ? "fully_released" : "partially_released";
    const [updated] = await db.update(requestItems).set({
      quantityReleased: newReleased,
      status: newStatus,
    }).where(eq(requestItems.id, id)).returning();
    return updated;
  }

  async createApproval(data: { requestId: number; role: string; action: string; type?: string; notes?: string; userId: number }): Promise<Approval> {
    const [approval] = await db.insert(approvals).values(data as any).returning();
    return approval;
  }

  async getApprovalsByRequest(requestId: number): Promise<(Approval & { user: User })[]> {
    const result = await db.select().from(approvals).where(eq(approvals.requestId, requestId)).orderBy(approvals.createdAt);
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return result.map(a => ({ ...a, user: userMap.get(a.userId)! }));
  }

  async createStockRelease(data: { requestId: number; createdBy: number; releaseType: string; branchId?: number | null; notes?: string }): Promise<StockRelease> {
    const [release] = await db.insert(stockReleases).values({
      requestId: data.requestId,
      createdBy: data.createdBy,
      releaseType: data.releaseType as any,
      branchId: data.branchId ?? null,
      status: "submitted",
      notes: data.notes,
    }).returning();
    return release;
  }

  async createStockReleaseItem(stockReleaseId: number, requestItemId: number, qty: number): Promise<StockReleaseItem> {
    const [item] = await db.insert(stockReleaseItems).values({ stockReleaseId, requestItemId, quantity: qty }).returning();
    return item;
  }

  async getStockReleasesByRequest(requestId: number): Promise<any[]> {
    const releases = await db.select().from(stockReleases).where(eq(stockReleases.requestId, requestId)).orderBy(desc(stockReleases.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const items = await db.select().from(requestItems);
    const itemMap = new Map(items.map(i => [i.id, i]));

    const releaseIds = releases.map(r => r.id);
    let allReleaseItems: StockReleaseItem[] = [];
    if (releaseIds.length > 0) {
      allReleaseItems = await db.select().from(stockReleaseItems).where(inArray(stockReleaseItems.stockReleaseId, releaseIds));
    }

    return releases.map(r => ({
      ...r,
      creator: userMap.get(r.createdBy),
      items: allReleaseItems
        .filter(ri => ri.stockReleaseId === r.id)
        .map(ri => ({ ...ri, requestItem: itemMap.get(ri.requestItemId) })),
    }));
  }

  async getAllStockReleases(): Promise<any[]> {
    const releases = await db.select().from(stockReleases).orderBy(desc(stockReleases.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allRequests = await db.select().from(requests);
    const reqMap = new Map(allRequests.map(r => [r.id, r]));
    const items = await db.select().from(requestItems);
    const itemMap = new Map(items.map(i => [i.id, i]));

    const releaseIds = releases.map(r => r.id);
    let allReleaseItems: StockReleaseItem[] = [];
    if (releaseIds.length > 0) {
      allReleaseItems = await db.select().from(stockReleaseItems).where(inArray(stockReleaseItems.stockReleaseId, releaseIds));
    }

    return releases.map(r => ({
      ...r,
      creator: userMap.get(r.createdBy),
      request: reqMap.get(r.requestId),
      items: allReleaseItems
        .filter(ri => ri.stockReleaseId === r.id)
        .map(ri => ({ ...ri, requestItem: itemMap.get(ri.requestItemId) })),
    }));
  }

  async getStockReleaseById(id: number): Promise<any> {
    const [release] = await db.select().from(stockReleases).where(eq(stockReleases.id, id));
    if (!release) return null;
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const items = await db.select().from(stockReleaseItems).where(eq(stockReleaseItems.stockReleaseId, id));
    const reqItems = await db.select().from(requestItems);
    const itemMap = new Map(reqItems.map(i => [i.id, i]));
    return {
      ...release,
      creator: userMap.get(release.createdBy),
      items: items.map(ri => ({ ...ri, requestItem: itemMap.get(ri.requestItemId) })),
    };
  }

  async updateStockReleaseStatus(id: number, status: string): Promise<void> {
    await db.update(stockReleases).set({ status: status as any, updatedAt: new Date() }).where(eq(stockReleases.id, id));
  }

  async createNotification(userId: number, title: string, message: string, link?: string): Promise<Notification> {
    const [notif] = await db.insert(notifications).values({ userId, title, message, link }).returning();
    return notif;
  }

  async getNotifications(userId: number): Promise<Notification[]> {
    return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(50);
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return result[0]?.count ?? 0;
  }

  async markNotificationRead(id: number): Promise<void> {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  async createAuditLog(data: { userId: number; action: string; entity: string; entityId: number; oldData?: any; newData?: any }): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  }

  async getAuditLogsByEntity(entity: string, entityId: number): Promise<(AuditLog & { user: User })[]> {
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.entity, entity), eq(auditLogs.entityId, entityId))).orderBy(desc(auditLogs.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return logs.map(l => ({ ...l, user: userMap.get(l.userId)! }));
  }

  async getAllAuditLogs(): Promise<(AuditLog & { user: User })[]> {
    const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return logs.map(l => ({ ...l, user: userMap.get(l.userId)! }));
  }

  async getDashboardStats(userId: number, role: string, branchId: number | null, branchIds?: number[], productCategoryId?: number | null): Promise<any> {
    let allRequests = await db.select().from(requests).orderBy(desc(requests.createdAt));

    if (role === "sales_rep") {
      allRequests = allRequests.filter(r => r.createdBy === userId || r.salesRepId === userId);
    } else if (role === "branch_manager") {
      const effectiveBranchIds = branchIds && branchIds.length > 0 ? branchIds : (branchId ? [branchId] : []);
      allRequests = allRequests.filter(r => effectiveBranchIds.includes(r.branchId));
    } else if (role === "category_manager" && productCategoryId) {
      allRequests = allRequests.filter(r => r.productCategoryId === productCategoryId);
    } else if (role === "admin" || role === "planning" || role === "sector_head") {
      // These roles see all requests in dashboard too
    }

    const totalRequests = allRequests.length;
    const pendingApproval = allRequests.filter(r => !["final_approved", "rejected"].includes(r.status)).length;
    const approved = allRequests.filter(r => r.status === "final_approved").length;
    const rejected = allRequests.filter(r => r.status === "rejected").length;

    const recent = allRequests.slice(0, 5);
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allItems = await db.select().from(requestItems);

    const recentRequests = recent.map(r => ({
      ...r,
      creator: userMap.get(r.createdBy),
      items: allItems.filter(i => i.requestId === r.id),
    }));

    return { totalRequests, pendingApproval, approved, rejected, recentRequests };
  }

  async getNextRequestNumber(): Promise<string> {
    const result = await db.select({ maxId: sql<number>`MAX(id)::int` }).from(requests);
    const nextId = (result[0]?.maxId ?? 0) + 1;
    return `REQ-${String(nextId).padStart(5, "0")}`;
  }

  async deleteRequest(id: number): Promise<void> {
    // Delete related records first to maintain referential integrity
    await db.delete(approvals).where(eq(approvals.requestId, id));
    await db.delete(stockReleaseItems).where(
      inArray(
        stockReleaseItems.stockReleaseId,
        db.select({ id: stockReleases.id }).from(stockReleases).where(eq(stockReleases.requestId, id))
      )
    );
    await db.delete(stockReleases).where(eq(stockReleases.requestId, id));
    await db.delete(requestItems).where(eq(requestItems.requestId, id));
    // We don't delete audit logs for the request itself, so they remain in the system history
    await db.delete(requests).where(eq(requests.id, id));
  }

  async getProducts(): Promise<Product[]> {
    return db.select().from(products).orderBy(products.itemCode);
  }

  async getProductsPaginated(params: { page: number; limit: number; search?: string }): Promise<{ data: Product[]; total: number; page: number; totalPages: number }> {
    const { page, limit, search } = params;
    const offset = (page - 1) * limit;

    const conditions = search
      ? or(
          ilike(products.itemCode, `%${search}%`),
          ilike(products.description, `%${search}%`),
          ilike(products.brand, `%${search}%`),
          ilike(products.category, `%${search}%`)
        )
      : undefined;

    const [totalResult] = await db
      .select({ value: count() })
      .from(products)
      .where(conditions);

    const total = totalResult?.value ?? 0;
    const totalPages = Math.ceil(total / limit);

    const data = await db
      .select()
      .from(products)
      .where(conditions)
      .orderBy(products.itemCode)
      .limit(limit)
      .offset(offset);

    return { data, total, page, totalPages };
  }

  async getProductByCode(itemCode: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.itemCode, itemCode));
    return product;
  }

  async getProductById(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(data).returning();
    return product;
  }

  async updateProduct(id: number, data: Partial<InsertProduct>): Promise<Product> {
    const [updated] = await db.update(products).set({ ...data, updatedAt: new Date() } as any).where(eq(products.id, id)).returning();
    if (!updated) throw new Error("Product not found");
    return updated;
  }

  async deleteProduct(id: number): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  async bulkUpsertProducts(items: InsertProduct[]): Promise<{ created: number; updated: number }> {
    if (items.length === 0) return { created: 0, updated: 0 };

    const itemCodes = items.map(i => i.itemCode);
    const existingProducts = await db.select().from(products).where(inArray(products.itemCode, itemCodes));
    const existingMap = new Map(existingProducts.map(p => [p.itemCode, p]));

    const toCreate: InsertProduct[] = [];
    const toUpdate: { id: number; data: Partial<InsertProduct> }[] = [];

    for (const item of items) {
      const existing = existingMap.get(item.itemCode);
      if (existing) {
        toUpdate.push({
          id: existing.id,
          data: {
            description: item.description || existing.description,
            brand: item.brand || existing.brand,
            department: item.department || existing.department,
            sellingPrice: item.sellingPrice || existing.sellingPrice,
            costPrice: item.costPrice || existing.costPrice,
            category: item.category || existing.category,
            salesMethod: item.salesMethod || existing.salesMethod || "",
            availableQuantity: item.availableQuantity ?? existing.availableQuantity,
            productCategoryId: item.productCategoryId ?? existing.productCategoryId,
          },
        });
      } else {
        toCreate.push(item);
      }
    }

    if (toCreate.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < toCreate.length; i += batchSize) {
        const batch = toCreate.slice(i, i + batchSize);
        await db.insert(products).values(batch);
      }
    }

    for (const { id, data } of toUpdate) {
      await db.update(products).set({ ...data, updatedAt: new Date() } as any).where(eq(products.id, id));
    }

    return { created: toCreate.length, updated: toUpdate.length };
  }

  async createRequestExtension(data: { requestId: number; requestedBy: number; requestedDays: number; previousExpiryDate: string; newExpiryDate: string; totalDaysFromCreation: number; status: string; notes?: string }): Promise<RequestExtension> {
    const [ext] = await db.insert(requestExtensions).values(data as any).returning();
    return ext;
  }

  async getExtensionsByRequest(requestId: number): Promise<(RequestExtension & { requestedByUser?: User })[]> {
    const exts = await db.select().from(requestExtensions).where(eq(requestExtensions.requestId, requestId)).orderBy(desc(requestExtensions.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return exts.map(e => ({ ...e, requestedByUser: userMap.get(e.requestedBy) }));
  }

  async getExtensionById(id: number): Promise<RequestExtension | undefined> {
    const [ext] = await db.select().from(requestExtensions).where(eq(requestExtensions.id, id));
    return ext;
  }

  async updateExtensionStatus(id: number, status: string, rejectionReason?: string): Promise<void> {
    const setData: any = { status };
    if (rejectionReason) setData.rejectionReason = rejectionReason;
    await db.update(requestExtensions).set(setData).where(eq(requestExtensions.id, id));
  }

  async incrementExtensionCount(requestId: number): Promise<void> {
    await db.update(requests).set({
      extensionCount: sql`COALESCE(${requests.extensionCount}, 0) + 1`,
      updatedAt: new Date(),
    }).where(eq(requests.id, requestId));
  }

  async getProductCategories(): Promise<ProductCategory[]> {
    return db.select().from(productCategories).orderBy(productCategories.name);
  }

  async createProductCategory(name: string): Promise<ProductCategory> {
    const [cat] = await db.insert(productCategories).values({ name }).returning();
    return cat;
  }

  async updateProductCategory(id: number, name: string): Promise<ProductCategory> {
    const [cat] = await db.update(productCategories).set({ name }).where(eq(productCategories.id, id)).returning();
    return cat;
  }

  async deleteProductCategory(id: number): Promise<void> {
    await db.delete(productCategories).where(eq(productCategories.id, id));
  }
}

export const storage = new DatabaseStorage();
