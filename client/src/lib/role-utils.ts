import type { UserRole, RequestStatus, ItemStatus, ApprovalAction } from "@shared/schema";
import type { Translations } from "@/lib/i18n";

export function getRoleLabels(t: Translations): Record<UserRole, string> {
  return t.roles as Record<UserRole, string>;
}

export function getStatusLabels(t: Translations): Record<RequestStatus, string> {
  return t.statuses as Record<RequestStatus, string>;
}

export function getDisplayStatus(status: string, salesChannel: string | undefined | null, isRTL: boolean, t: Translations): string {
  const labels = getStatusLabels(t);
  if (status === "category_approved" && salesChannel === "strategic_reservation") {
    return isRTL ? "معتمد من التخطيط" : "Planning Approved";
  }
  return labels[status as RequestStatus] || status;
}

export function getItemStatusLabels(t: Translations): Record<ItemStatus, string> {
  return t.itemStatuses as Record<ItemStatus, string>;
}

export function getActionLabels(t: Translations): Record<ApprovalAction, string> {
  return t.actions as Record<ApprovalAction, string>;
}

export function getStockReleaseStatusLabels(t: Translations): Record<string, string> {
  return t.releaseStatuses as Record<string, string>;
}

export function getStatusVariant(status: RequestStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "submitted": return "secondary";
    case "branch_approved": return "outline";
    case "category_approved": return "outline";
    case "final_approved": return "default";
    case "rejected": return "destructive";
    case "expired": return "destructive";
    case "lost_opportunity": return "destructive";
    case "confirmed_lost_opportunity": return "destructive";
    case "closed": return "default";
    default: return "secondary";
  }
}

export function getItemStatusColor(status: ItemStatus): string {
  switch (status) {
    case "pending": return "text-muted-foreground";
    case "partially_released": return "text-amber-600 dark:text-amber-400";
    case "fully_released": return "text-emerald-600 dark:text-emerald-400";
    default: return "text-muted-foreground";
  }
}

export function canApproveRequest(role: UserRole, status: RequestStatus, duration?: number, alreadyHasSectorHeadApproval?: boolean, salesChannel?: string): boolean {
  if (status === "expired" || status === "lost_opportunity" || status === "confirmed_lost_opportunity" || status === "closed") return false;
  const isStrategic = salesChannel === "strategic_reservation";
  if (role === "admin") return status !== "rejected" && status !== "final_approved";
  if (role === "branch_manager") return status === "submitted";
  if (role === "category_manager") return status === "branch_approved";
  if (role === "sector_head") {
    if (status !== "category_approved") return false;
    if (!isStrategic && (duration ?? 0) <= 90) return false;
    if (alreadyHasSectorHeadApproval) return false;
    return true;
  }
  if (role === "planning") {
    if (isStrategic) return false;
    return status === "category_approved";
  }
  return false;
}

export function canReleaseStock(role: UserRole, status: RequestStatus, salesChannel?: string): boolean {
  if (status === "expired" || status === "lost_opportunity" || status === "confirmed_lost_opportunity" || status === "closed") return false;
  if (status !== "final_approved") return false;
  if (role === "admin") return true;
  if (salesChannel === "strategic_reservation" && role === "planning") return true;
  return role === "sales_rep" || role === "branch_manager";
}

export function canApproveStockRelease(role: UserRole, releaseStatus: string): boolean {
  if (role === "admin") return releaseStatus !== "rejected" && releaseStatus !== "final_approved";
  if (role === "branch_manager") return releaseStatus === "submitted";
  if (role === "planning") return releaseStatus === "branch_approved";
  return false;
}

export function getStockReleaseStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "submitted": return "secondary";
    case "branch_approved": return "outline";
    case "final_approved": return "default";
    case "rejected": return "destructive";
    default: return "secondary";
  }
}

export function canEditRequest(role: UserRole, status: RequestStatus, isCreator: boolean): boolean {
  if (status === "expired" || status === "lost_opportunity" || status === "confirmed_lost_opportunity" || status === "closed") return false;
  if (role === "admin") return true;
  if (role === "sales_rep") return isCreator && (status === "rejected" || status === "submitted");
  if (role === "branch_manager") return status === "submitted";
  if (role === "category_manager") return status === "branch_approved";
  if (role === "planning") return status === "category_approved" || status === "final_approved";
  return false;
}

export function canApproveExtension(role: UserRole, extensionStatus: string): boolean {
  if (role === "admin") return extensionStatus !== "rejected" && extensionStatus !== "approved";
  if (role === "branch_manager") return extensionStatus === "pending_branch";
  if (role === "category_manager") return extensionStatus === "pending_category";
  if (role === "planning") return extensionStatus === "pending_planning";
  if (role === "sector_head") return extensionStatus === "pending_sector_head";
  return false;
}

export function getExtensionStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved": return "default";
    case "rejected": return "destructive";
    default: return "secondary";
  }
}

export function getNextApprovalRole(status: RequestStatus): UserRole | null {
  switch (status) {
    case "submitted": return "branch_manager";
    case "branch_approved": return "category_manager";
    case "category_approved": return "planning";
    default: return null;
  }
}
