import bcrypt from "bcryptjs";
import { db } from "./storage";
import { users, branches, requests, requestItems, approvals, stockReleases, stockReleaseItems, notifications, auditLogs, adminDepartments, adminWarehouses } from "@shared/schema";

export async function seedDatabase() {
  const existingDepts = await db.select().from(adminDepartments);
  if (existingDepts.length === 0) {
    await db.insert(adminDepartments).values([
      { name: "Sales" },
      { name: "Marketing" },
      { name: "Operations" },
      { name: "Logistics" },
      { name: "Projects" },
      { name: "Procurement" },
      { name: "Finance" },
    ]);
    console.log("Seeded default departments");
  }

  const existingWH = await db.select().from(adminWarehouses);
  if (existingWH.length === 0) {
    await db.insert(adminWarehouses).values([
      { name: "Main Warehouse" },
      { name: "Warehouse A" },
      { name: "Warehouse B" },
      { name: "Warehouse C" },
      { name: "External Storage" },
    ]);
    console.log("Seeded default warehouses");
  }

  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) return;

  console.log("Seeding database...");

  const hash = await bcrypt.hash("password123", 10);

  const [branch1] = await db.insert(branches).values({ name: "Riyadh Branch" }).returning();
  const [branch2] = await db.insert(branches).values({ name: "Jeddah Branch" }).returning();

  const [salesRep] = await db.insert(users).values({
    name: "Ahmed Al-Salem", email: "ahmed@baitiba.com", password: hash, role: "sales_rep", branchId: branch1.id,
  }).returning();

  const [salesRep2] = await db.insert(users).values({
    name: "Fahad Al-Otaibi", email: "fahad@baitiba.com", password: hash, role: "sales_rep", branchId: branch2.id,
  }).returning();

  const [branchMgr] = await db.insert(users).values({
    name: "Khalid Al-Rashid", email: "khalid@baitiba.com", password: hash, role: "branch_manager", branchId: branch1.id,
  }).returning();

  const [branchMgr2] = await db.insert(users).values({
    name: "Omar Al-Farsi", email: "omar@baitiba.com", password: hash, role: "branch_manager", branchId: branch2.id,
  }).returning();

  const [catMgr] = await db.insert(users).values({
    name: "Nora Al-Dosari", email: "nora@baitiba.com", password: hash, role: "category_manager", branchId: null,
  }).returning();

  const [planner] = await db.insert(users).values({
    name: "Sultan Al-Harbi", email: "sultan@baitiba.com", password: hash, role: "planning", branchId: null,
  }).returning();

  const [sectorHead] = await db.insert(users).values({
    name: "Mansour Al-Qahtani", email: "mansour@baitiba.com", password: hash, role: "sector_head", branchId: null,
  }).returning();

  const [admin] = await db.insert(users).values({
    name: "Sara Al-Admin", email: "admin@baitiba.com", password: hash, role: "admin", branchId: null,
  }).returning();

  const today = new Date().toISOString().split("T")[0];
  const addDays = (dateStr: string, days: number) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  };

  const [req1] = await db.insert(requests).values({
    requestNumber: "REQ-00001",
    createdBy: salesRep.id,
    branchId: branch1.id,
    status: "submitted",
    notes: "Urgent office supply request",
    requestDate: today,
    department: "Sales",
    projectName: "Q1 Office Restock",
  }).returning();

  await db.insert(requestItems).values([
    {
      requestId: req1.id,
      productName: "ITM-001 - Premium Desk Chair",
      itemCode: "ITM-001",
      itemDescription: "Premium Desk Chair",
      brand: "ErgoMax",
      quantityRequested: 50,
      warehouse: "Main Warehouse",
      quantityReleased: 0,
      status: "pending",
    },
    {
      requestId: req1.id,
      productName: "ITM-002 - Standing Desk",
      itemCode: "ITM-002",
      itemDescription: "Standing Desk",
      brand: "FlexiDesk",
      quantityRequested: 30,
      warehouse: "Main Warehouse",
      quantityReleased: 0,
      status: "pending",
    },
  ]);

  const [req2] = await db.insert(requests).values({
    requestNumber: "REQ-00002",
    createdBy: salesRep.id,
    branchId: branch1.id,
    status: "branch_approved",
    notes: "IT equipment for new hires",
    requestDate: today,
    department: "Operations",
    projectName: "New Hire Setup",
    reservationDuration: "45",
  }).returning();

  await db.insert(requestItems).values([
    {
      requestId: req2.id,
      productName: "ITM-003 - Laptop Pro",
      itemCode: "ITM-003",
      itemDescription: "Laptop Pro 15-inch",
      brand: "TechCorp",
      quantityRequested: 20,
      warehouse: "Warehouse A",
      quantityReleased: 0,
      status: "pending",
    },
  ]);

  const [req3] = await db.insert(requests).values({
    requestNumber: "REQ-00003",
    createdBy: salesRep2.id,
    branchId: branch2.id,
    status: "final_approved",
    notes: "Warehouse restocking",
    requestDate: today,
    department: "Logistics",
    projectName: "Warehouse Resupply",
    reservationDuration: "90",
    advancePayment: "5000",
  }).returning();

  await db.insert(requestItems).values([
    {
      requestId: req3.id,
      productName: "ITM-004 - Pallet Racking",
      itemCode: "ITM-004",
      itemDescription: "Industrial Pallet Racking",
      brand: "StorePro",
      quantityRequested: 100,
      warehouse: "Warehouse B",
      quantityReleased: 40,
      status: "partially_released",
    },
    {
      requestId: req3.id,
      productName: "ITM-005 - Forklift",
      itemCode: "ITM-005",
      itemDescription: "Electric Forklift 3T",
      brand: "LiftMax",
      quantityRequested: 5,
      warehouse: "Warehouse B",
      quantityReleased: 5,
      status: "fully_released",
    },
  ]);

  const [req4] = await db.insert(requests).values({
    requestNumber: "REQ-00004",
    createdBy: salesRep2.id,
    branchId: branch2.id,
    status: "rejected",
    notes: "Emergency supply",
    requestDate: today,
    department: "Procurement",
    projectName: "Emergency Procurement",
  }).returning();

  await db.insert(requestItems).values([
    {
      requestId: req4.id,
      productName: "ITM-006 - Safety Equipment",
      itemCode: "ITM-006",
      itemDescription: "Safety Helmet Set",
      brand: "SafeGuard",
      quantityRequested: 200,
      warehouse: "Main Warehouse",
      quantityReleased: 0,
      status: "pending",
    },
  ]);

  await db.insert(approvals).values([
    { requestId: req2.id, role: "branch_manager", action: "approve", notes: "Approved for new hires", userId: branchMgr.id },
    { requestId: req3.id, role: "branch_manager", action: "approve", userId: branchMgr2.id },
    { requestId: req3.id, role: "category_manager", action: "approve", userId: catMgr.id },
    { requestId: req3.id, role: "planning", action: "approve", notes: "Final approval granted", userId: planner.id },
    { requestId: req4.id, role: "branch_manager", action: "reject", notes: "Budget exceeded", userId: branchMgr2.id },
  ]);

  await db.insert(stockReleases).values([
    { requestId: req3.id, createdBy: planner.id, notes: "Partial release batch 1" },
  ]).returning().then(async ([release]) => {
    await db.insert(stockReleaseItems).values([
      { stockReleaseId: release.id, requestItemId: (await db.select().from(requestItems).where(require("drizzle-orm").eq(requestItems.requestId, req3.id)))[0].id, quantity: 40 },
      { stockReleaseId: release.id, requestItemId: (await db.select().from(requestItems).where(require("drizzle-orm").eq(requestItems.requestId, req3.id)))[1].id, quantity: 5 },
    ]);
  });

  await db.insert(auditLogs).values([
    { userId: salesRep.id, action: "created request", entity: "request", entityId: req1.id, newData: { projectName: "Q1 Office Restock" } },
    { userId: salesRep.id, action: "created request", entity: "request", entityId: req2.id, newData: { projectName: "New Hire Setup" } },
    { userId: branchMgr.id, action: "approved request", entity: "request", entityId: req2.id, oldData: { status: "submitted" }, newData: { status: "branch_approved" } },
    { userId: salesRep2.id, action: "created request", entity: "request", entityId: req3.id, newData: { projectName: "Warehouse Resupply" } },
    { userId: branchMgr2.id, action: "approved request", entity: "request", entityId: req3.id, oldData: { status: "submitted" }, newData: { status: "branch_approved" } },
    { userId: catMgr.id, action: "approved request", entity: "request", entityId: req3.id, oldData: { status: "branch_approved" }, newData: { status: "category_approved" } },
    { userId: planner.id, action: "approved request", entity: "request", entityId: req3.id, oldData: { status: "category_approved" }, newData: { status: "final_approved" } },
    { userId: planner.id, action: "released stock", entity: "request", entityId: req3.id, newData: { notes: "Partial release" } },
    { userId: salesRep2.id, action: "created request", entity: "request", entityId: req4.id, newData: { projectName: "Emergency Procurement" } },
    { userId: branchMgr2.id, action: "rejected request", entity: "request", entityId: req4.id, oldData: { status: "submitted" }, newData: { status: "rejected" } },
  ]);

  await db.insert(notifications).values([
    { userId: salesRep.id, title: "Welcome", message: "Welcome to Bait Al-Iba Inventory System", isRead: false },
    { userId: salesRep2.id, title: "Request Approved", message: "Your request REQ-00003 received final approval", isRead: false, link: `/requests/${req3.id}` },
    { userId: salesRep2.id, title: "Stock Released", message: "Stock released for request REQ-00003", isRead: false, link: `/requests/${req3.id}` },
    { userId: salesRep2.id, title: "Request Rejected", message: "Your request REQ-00004 was rejected", isRead: true, link: `/requests/${req4.id}` },
    { userId: branchMgr.id, title: "New Request", message: "Ahmed Al-Salem submitted REQ-00001", isRead: false, link: `/requests/${req1.id}` },
    { userId: admin.id, title: "New Request", message: "Ahmed Al-Salem submitted REQ-00001", isRead: false, link: `/requests/${req1.id}` },
    { userId: admin.id, title: "New Request", message: "Ahmed Al-Salem submitted REQ-00002", isRead: false, link: `/requests/${req2.id}` },
    { userId: catMgr.id, title: "Pending Approval", message: "Request REQ-00002 needs your approval", isRead: false, link: `/requests/${req2.id}` },
    { userId: planner.id, title: "System Update", message: "Inventory system has been updated", isRead: false },
  ]);

  console.log("Database seeded successfully!");
  console.log("\nDemo accounts (all use password: password123):");
  console.log("  Sales Rep:        ahmed@baitiba.com");
  console.log("  Sales Rep 2:      fahad@baitiba.com");
  console.log("  Branch Manager:   khalid@baitiba.com");
  console.log("  Branch Manager 2: omar@baitiba.com");
  console.log("  Category Manager: nora@baitiba.com");
  console.log("  Planning:         sultan@baitiba.com");
  console.log("  Sector Head:      mansour@baitiba.com");
  console.log("  Admin:            admin@baitiba.com");
}
