import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, serial, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoles = ["sales_rep", "branch_manager", "category_manager", "planning", "sector_head", "admin"] as const;
export type UserRole = typeof userRoles[number];

export const requestStatuses = ["submitted", "branch_approved", "category_approved", "final_approved", "rejected", "expired", "lost_opportunity", "confirmed_lost_opportunity", "closed"] as const;
export type RequestStatus = typeof requestStatuses[number];

export const itemStatuses = ["pending", "partially_released", "fully_released"] as const;
export type ItemStatus = typeof itemStatuses[number];

export const approvalActions = ["approve", "reject", "edit"] as const;
export type ApprovalAction = typeof approvalActions[number];

export const reservationDurationOptions = ["7", "15", "30", "45", "60", "75", "90", "120"] as const;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().$type<UserRole>(),
  branchId: integer("branch_id"),
  productCategoryId: integer("product_category_id"),
});

export const branches = pgTable("branches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const adminDepartments = pgTable("admin_departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  branchId: integer("branch_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const departmentBranches = pgTable("department_branches", {
  id: serial("id").primaryKey(),
  departmentId: integer("department_id").notNull(),
  branchId: integer("branch_id").notNull(),
});

export type DepartmentBranch = typeof departmentBranches.$inferSelect;

export const userBranches = pgTable("user_branches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  branchId: integer("branch_id").notNull(),
});

export type UserBranch = typeof userBranches.$inferSelect;

export const adminWarehouses = pgTable("admin_warehouses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  location: text("location").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productCategories = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const requests = pgTable("requests", {
  id: serial("id").primaryKey(),
  requestNumber: text("request_number").notNull().unique(),
  createdBy: integer("created_by").notNull(),
  salesRepId: integer("sales_rep_id"),
  branchId: integer("branch_id").notNull(),
  status: text("status").notNull().$type<RequestStatus>().default("submitted"),
  notes: text("notes"),
  requestDate: text("request_date").notNull(),
  department: text("department").notNull(),
  customerName: text("customer_name").notNull().default(""),
  customerAccountNumber: text("customer_account_number").notNull().default(""),
  projectName: text("project_name").notNull(),
  reservationDuration: text("reservation_duration"),
  reservationEndDate: text("reservation_end_date"),
  advancePayment: numeric("advance_payment"),
  sapReservationNumber: text("sap_reservation_number"),
  purchaseOrderFile: text("purchase_order_file"),
  accountStatementFile: text("account_statement_file"),
  productCategoryId: integer("product_category_id"),
  salesChannel: text("sales_channel"),
  extensionCount: integer("extension_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const requestItems = pgTable("request_items", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  productName: text("product_name").notNull(),
  itemCode: text("item_code").notNull(),
  itemDescription: text("item_description").notNull(),
  brand: text("brand").notNull(),
  quantityRequested: integer("quantity_requested").notNull(),
  warehouse: text("warehouse").notNull(),
  sellingPrice: numeric("selling_price"),
  costPrice: numeric("cost_price"),
  quantityReleased: integer("quantity_released").notNull().default(0),
  status: text("status").notNull().$type<ItemStatus>().default("pending"),
  quantityChangedFrom: integer("quantity_changed_from"),
  isNewItem: boolean("is_new_item").default(false).notNull(),
});

export const approvals = pgTable("approvals", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  role: text("role").notNull().$type<UserRole>(),
  action: text("action").notNull().$type<ApprovalAction>(),
  type: text("type").notNull().default("request"),
  notes: text("notes"),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const extensionStatuses = ["pending_branch", "pending_category", "pending_planning", "pending_sector_head", "approved", "rejected"] as const;
export type ExtensionStatus = typeof extensionStatuses[number];

export const requestExtensions = pgTable("request_extensions", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  requestedBy: integer("requested_by").notNull(),
  requestedDays: integer("requested_days").notNull(),
  previousExpiryDate: text("previous_expiry_date").notNull(),
  newExpiryDate: text("new_expiry_date").notNull(),
  totalDaysFromCreation: integer("total_days_from_creation").notNull(),
  status: text("status").notNull().$type<ExtensionStatus>().default("pending_branch"),
  rejectionReason: text("rejection_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stockReleaseStatuses = ["submitted", "branch_approved", "category_approved", "final_approved", "rejected"] as const;
export type StockReleaseStatus = typeof stockReleaseStatuses[number];

export const stockReleaseTypes = ["full", "partial"] as const;
export type StockReleaseType = typeof stockReleaseTypes[number];

export const stockReleases = pgTable("stock_releases", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  createdBy: integer("created_by").notNull(),
  releaseType: text("release_type").notNull().$type<StockReleaseType>().default("partial"),
  status: text("status").notNull().$type<StockReleaseStatus>().default("submitted"),
  branchId: integer("branch_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const stockReleaseItems = pgTable("stock_release_items", {
  id: serial("id").primaryKey(),
  stockReleaseId: integer("stock_release_id").notNull(),
  requestItemId: integer("request_item_id").notNull(),
  quantity: integer("quantity").notNull(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  link: text("link"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id").notNull(),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  itemCode: text("item_code").notNull().unique(),
  description: text("description").notNull(),
  brand: text("brand").notNull(),
  department: text("department").notNull(),
  sellingPrice: numeric("selling_price").notNull(),
  costPrice: numeric("cost_price").notNull(),
  category: text("category").notNull(),
  salesMethod: text("sales_method").notNull().default(""),
  availableQuantity: integer("available_quantity").notNull().default(0),
  productCategoryId: integer("product_category_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true, updatedAt: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertBranchSchema = createInsertSchema(branches).omit({ id: true });
export const insertRequestSchema = createInsertSchema(requests).omit({ id: true, requestNumber: true, createdAt: true, updatedAt: true, status: true });
export const insertRequestItemSchema = createInsertSchema(requestItems).omit({ id: true, quantityReleased: true, status: true });
export const insertApprovalSchema = createInsertSchema(approvals).omit({ id: true, createdAt: true });
export const insertStockReleaseSchema = createInsertSchema(stockReleases).omit({ id: true, createdAt: true });
export const insertStockReleaseItemSchema = createInsertSchema(stockReleaseItems).omit({ id: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, isRead: true, createdAt: true });
export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  recipientUserId: integer("recipient_user_id"),
  subject: text("subject").notNull(),
  eventType: text("event_type").notNull(),
  requestId: integer("request_id"),
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailPreferences = pgTable("email_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  requestCreated: boolean("request_created").notNull().default(true),
  requestApproved: boolean("request_approved").notNull().default(true),
  requestRejected: boolean("request_rejected").notNull().default(true),
  requestFinalApproved: boolean("request_final_approved").notNull().default(true),
  requestEdited: boolean("request_edited").notNull().default(true),
  stockReleaseRequested: boolean("stock_release_requested").notNull().default(true),
  stockReleaseApproved: boolean("stock_release_approved").notNull().default(true),
  stockReleaseRejected: boolean("stock_release_rejected").notNull().default(true),
  stockReleaseFinalApproved: boolean("stock_release_final_approved").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRequestExtensionSchema = createInsertSchema(requestExtensions).omit({ id: true, createdAt: true });

export const createExtensionSchema = z.object({
  requestedDays: z.number().int().positive(),
  notes: z.string().optional(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, createdAt: true });
export const insertEmailPreferencesSchema = createInsertSchema(emailPreferences).omit({ id: true, updatedAt: true });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createRequestItemSchema = z.object({
  itemCode: z.string().min(1, "Item code is required"),
  itemDescription: z.string().min(1, "Item description is required"),
  brand: z.string().min(1, "Brand is required"),
  quantityRequested: z.number().int().positive("Quantity must be greater than 0"),
  warehouse: z.string().min(1, "Warehouse is required"),
  sellingPrice: z.string().optional(),
  costPrice: z.string().optional(),
});

export const createRequestSchema = z.object({
  department: z.string().min(1, "Department is required"),
  customerName: z.string().min(1, "Customer name is required"),
  customerAccountNumber: z.string().min(1, "Customer account number is required"),
  projectName: z.string().min(1, "Project name is required"),
  salesRepId: z.number().int().optional(),
  productCategoryId: z.number().int().min(1, "Product category is required"),
  reservationDuration: z.string().min(1, "Reservation duration is required"),
  reservationEndDate: z.string().min(1, "Reservation end date is required"),
  advancePayment: z.number().optional(),
  purchaseOrderFile: z.string().optional(),
  accountStatementFile: z.string().optional(),
  salesChannel: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(createRequestItemSchema).min(1, "At least one product is required"),
});

export const stockReleaseSchema = z.object({
  notes: z.string().optional(),
  items: z.array(z.object({
    requestItemId: z.number().int(),
    quantity: z.number().int().positive(),
  })).min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type RequestItem = typeof requestItems.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type StockRelease = typeof stockReleases.$inferSelect;
export type StockReleaseItem = typeof stockReleaseItems.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AdminDepartment = typeof adminDepartments.$inferSelect;
export type AdminWarehouse = typeof adminWarehouses.$inferSelect;
export type EmailLog = typeof emailLogs.$inferSelect;
export type EmailPreferences = typeof emailPreferences.$inferSelect;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type RequestExtension = typeof requestExtensions.$inferSelect;
export type ProductCategory = typeof productCategories.$inferSelect;
