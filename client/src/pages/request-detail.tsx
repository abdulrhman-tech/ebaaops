import { useState, useEffect, useRef, useCallback } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useLocation } from "wouter";

function buildFileUrl(filePath: string): string {
  if (!filePath) return "";
  if (filePath.startsWith("/cloud-uploads/") || filePath.startsWith("/uploads/")) return filePath;
  return `/uploads/${filePath}`;
}

function formatDateTime(dateStr: string | Date) {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

async function exportReleaseToExcel(release: any, requestId: number, warehouses: { name: string; location: string | null }[] = []) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("بيانات الصرف");

  const warehouseLocationMap: Record<string, string> = {};
  for (const wh of warehouses) {
    warehouseLocationMap[wh.name] = wh.location || "";
  }

  // تعيين عرض الأعمدة في البداية
  worksheet.columns = [
    { header: "البيان", key: "col1", width: 25 },
    { header: "البيانات", key: "col2", width: 25 },
    { header: "المستودع", key: "col3", width: 25 },
    { header: "موقع التخزين", key: "col4", width: 25 }
  ];
  
  // معلومات الرأس
  worksheet.addRow({ col1: "رقم الطلب", col2: requestId });
  worksheet.addRow({ col1: "عملية صرف", col2: release.id });
  worksheet.addRow({ col1: "النوع", col2: release.releaseType === "full" ? "كامل" : "جزئي" });
  worksheet.addRow({ col1: "التاريخ", col2: formatDateTime(release.createdAt) });
  worksheet.addRow({ col1: "المنشئ", col2: release.creator?.name || "" });
  
  // صف فارغ
  worksheet.addRow({});
  
  // رأس جدول المنتجات
  const headerRow = worksheet.addRow({ col1: "رمز الصنف", col2: "الكمية (وحدة)", col3: "المستودع", col4: "موقع التخزين" });
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD3D3D3" } };
  
  // بيانات المنتجات
  release.items.forEach((item: any) => {
    const wh = item.requestItem?.warehouse || "";
    worksheet.addRow({
      col1: item.requestItem?.itemCode || "",
      col2: item.quantity,
      col3: wh || "-",
      col4: warehouseLocationMap[wh] || "-"
    });
  });
  
  // الملاحظات
  if (release.notes) {
    worksheet.addRow({});
    worksheet.addRow({ col1: "ملاحظات", col2: release.notes });
  }
  
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `صرف-${release.id}-${new Date().toISOString().split("T")[0]}.xlsx`);
  link.click();
  URL.revokeObjectURL(url);
}
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getStatusLabels,
  getDisplayStatus,
  getStatusVariant,
  getItemStatusLabels,
  getItemStatusColor,
  canApproveRequest,
  canReleaseStock,
  canApproveStockRelease,
  canEditRequest,
  getStockReleaseStatusLabels,
  getStockReleaseStatusVariant,
  getActionLabels,
  getRoleLabels,
} from "@/lib/role-utils";
import {
  CheckCircle,
  XCircle,
  Check,
  X,
  Edit3,
  Package,
  Loader2,
  Trash2,
  User as UserIcon,
  Clock,
  ArrowRight,
  ArrowLeft,
  Truck,
  Building2,
  Calendar,
  FolderOpen,
  Warehouse,
  Tag,
  FileText,
  AlertTriangle,
  Upload,
  Download,
} from "lucide-react";
import { Link } from "wouter";
import type { Request, RequestItem, Approval, StockRelease, StockReleaseItem, AuditLog, User, RequestExtension } from "@shared/schema";
import { canApproveExtension, getExtensionStatusVariant } from "@/lib/role-utils";

interface RequestDetail extends Request {
  items: RequestItem[];
  creator: User;
  salesRep?: User;
  approvals: (Approval & { user: User })[];
  stockReleases: (StockRelease & { items: (StockReleaseItem & { requestItem: RequestItem })[]; creator: User })[];
  extensions: (RequestExtension & { requestedByUser?: User })[];
  auditLogs: (AuditLog & { user: User })[];
}

export default function RequestDetailPage({ params }: { params: { id: string } }) {
  usePageTitle("تفاصيل الطلب");
  const [, setLocation] = useLocation();
  const { token, user } = useAuth();
  const { toast } = useToast();
  const { t, isRTL } = useLang();
  const statusLabels = getStatusLabels(t);
  const itemStatusLabels = getItemStatusLabels(t);
  const stockReleaseStatusLabels = getStockReleaseStatusLabels(t);
  const actionLabels = getActionLabels(t);
  const roleLabels = getRoleLabels(t);
  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const [approvalDialog, setApprovalDialog] = useState<"approve" | "reject" | null>(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [releaseDialog, setReleaseDialog] = useState<"full" | "partial" | null>(null);
  const [releaseItems, setReleaseItems] = useState<Record<number, number>>({});
  const [releaseNotes, setReleaseNotes] = useState("");
  const [editingReleaseId, setEditingReleaseId] = useState<number | null>(null);
  const [releaseApprovalDialog, setReleaseApprovalDialog] = useState<{ releaseId: number; action: "approve" | "reject" } | null>(null);
  const [releaseApprovalNotes, setReleaseApprovalNotes] = useState("");
  const [editDialog, setEditDialog] = useState(false);
  const [extendDialog, setExtendDialog] = useState(false);
  const [extensionDays, setExtensionDays] = useState("");
  const [extensionNotes, setExtensionNotes] = useState("");
  const [extensionApprovalDialog, setExtensionApprovalDialog] = useState<{ extensionId: number; action: "approve" | "reject"; originalNewExpiryDate: string; previousExpiryDate: string } | null>(null);
  const [extensionEditedDate, setExtensionEditedDate] = useState<string>("");
  const [extensionApprovalNotes, setExtensionApprovalNotes] = useState("");
  const [endDateDialog, setEndDateDialog] = useState(false);
  const [newEndDate, setNewEndDate] = useState("");
  const [endDateReason, setEndDateReason] = useState("");
  type EditItem = { itemCode: string; productName: string; itemDescription: string; brand: string; quantityRequested: number; warehouse: string; sellingPrice: string; costPrice: string; lookupStatus: "idle" | "loading" | "found" | "not_found" };
  const [editForm, setEditForm] = useState<{
    department: string;
    customerName: string;
    customerAccountNumber: string;
    projectName: string;
    requestDate: string;
    reservationDuration: string;
    reservationEndDate: string;
    advancePayment: string;
    salesRepId: number | null;
    sapReservationNumber: string;
    notes: string;
    items: EditItem[];
  }>({
    department: "",
    customerName: "",
    customerAccountNumber: "",
    projectName: "",
    requestDate: "",
    reservationDuration: "",
    reservationEndDate: "",
    advancePayment: "",
    salesRepId: null,
    sapReservationNumber: "",
    notes: "",
    items: [],
  });
  const [editPurchaseOrderFile, setEditPurchaseOrderFile] = useState<string>("");
  const [editPoFileName, setEditPoFileName] = useState("");
  const [editUploadingPO, setEditUploadingPO] = useState(false);
  const [editAccountStatementFile, setEditAccountStatementFile] = useState<string>("");
  const [editAsFileName, setEditAsFileName] = useState("");
  const [editUploadingAS, setEditUploadingAS] = useState(false);
  const editPoFileInputRef = useRef<HTMLInputElement>(null);
  const editAsFileInputRef = useRef<HTMLInputElement>(null);

  const isPlanningEditor = user?.role === "planning" || user?.role === "admin";
  const editLookupTimers = useRef<Record<number, NodeJS.Timeout>>({});

  const lookupEditProduct = useCallback((index: number, code: string) => {
    if (editLookupTimers.current[index]) {
      clearTimeout(editLookupTimers.current[index]);
    }
    if (!code.trim()) {
      setEditForm(prev => ({
        ...prev,
        items: prev.items.map((item, i) =>
          i === index ? { ...item, itemDescription: "", productName: "", brand: "", sellingPrice: "", costPrice: "", lookupStatus: "idle" as const } : item
        ),
      }));
      return;
    }
    setEditForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, lookupStatus: "loading" as const } : item
      ),
    }));
    editLookupTimers.current[index] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/lookup/${encodeURIComponent(code.trim())}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          setEditForm(prev => ({
            ...prev,
            items: prev.items.map((item, i) =>
              i === index ? { ...item, itemDescription: "", productName: "", brand: "", sellingPrice: "", costPrice: "", lookupStatus: "not_found" as const } : item
            ),
          }));
          return;
        }
        if (!res.ok) throw new Error("Lookup failed");
        const product = await res.json();
        setEditForm(prev => ({
          ...prev,
          items: prev.items.map((item, i) =>
            i === index ? {
              ...item,
              itemDescription: product.description || "",
              productName: product.name || "",
              brand: product.brand || "",
              sellingPrice: product.sellingPrice || "",
              costPrice: product.costPrice || "",
              lookupStatus: "found" as const,
            } : item
          ),
        }));
      } catch {
        setEditForm(prev => ({
          ...prev,
          items: prev.items.map((item, i) =>
            i === index ? { ...item, lookupStatus: "idle" as const } : item
          ),
        }));
      }
    }, 500);
  }, [token]);

  useEffect(() => {
    if (editDialog && editForm.reservationDuration && !isPlanningEditor) {
      const today = new Date().toISOString().split("T")[0];
      const d = new Date(today);
      d.setDate(d.getDate() + parseInt(editForm.reservationDuration, 10));
      const newEnd = d.toISOString().split("T")[0];
      if (newEnd !== editForm.reservationEndDate) {
        setEditForm(prev => ({ ...prev, reservationEndDate: newEnd }));
      }
    }
  }, [editForm.reservationDuration, editDialog, isPlanningEditor]);

  useEffect(() => {
    if (editDialog && isPlanningEditor && editForm.requestDate && editForm.reservationDuration) {
      const d = new Date(editForm.requestDate);
      d.setDate(d.getDate() + parseInt(editForm.reservationDuration, 10));
      const newEnd = d.toISOString().split("T")[0];
      if (newEnd !== editForm.reservationEndDate) {
        setEditForm(prev => ({ ...prev, reservationEndDate: newEnd }));
      }
    }
  }, [editForm.requestDate, editForm.reservationDuration, editDialog, isPlanningEditor]);

  const { data: request, isLoading } = useQuery<RequestDetail>({
    queryKey: ["/api/requests", params.id],
    queryFn: async () => {
      const res = await fetch(`/api/requests/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ action, notes }: { action: string; notes: string }) => {
      const res = await fetch(`/api/requests/${params.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, notes }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setApprovalDialog(null);
      setApprovalNotes("");
      toast({ title: t.requestDetail.actionDone });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const [deleteDialog, setDeleteDialog] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/requests/${params.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ 
        title: isRTL ? "تم الحذف بنجاح" : "Deleted Successfully", 
        description: isRTL ? "تم حذف الطلب نهائياً من النظام" : "Request has been permanently deleted" 
      });
      setLocation("/requests");
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        releaseType: releaseDialog,
        notes: releaseNotes || undefined,
      };

      if (releaseDialog === "partial") {
        body.items = Object.entries(releaseItems)
          .filter(([, qty]) => qty > 0)
          .map(([id, qty]) => ({ requestItemId: Number(id), quantity: qty }));
        if (body.items.length === 0) throw new Error(t.requestDetail.selectAtLeastOne);
      }

      const url = editingReleaseId
        ? `/api/stock-releases/${editingReleaseId}`
        : `/api/requests/${params.id}/release`;
      const method = editingReleaseId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setReleaseDialog(null);
      setReleaseItems({});
      setReleaseNotes("");
      const wasEdit = !!editingReleaseId;
      setEditingReleaseId(null);
      toast({ title: wasEdit ? (isRTL ? "تم تحديث طلب الصرف" : "Stock release updated") : t.requestDetail.releaseSubmitted });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const deleteReleaseMutation = useMutation({
    mutationFn: async (releaseId: number) => {
      const res = await fetch(`/api/stock-releases/${releaseId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: isRTL ? "تم حذف طلب الصرف" : "Stock release deleted" });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const releaseApprovalMutation = useMutation({
    mutationFn: async ({ releaseId, action, notes }: { releaseId: number; action: string; notes: string }) => {
      const res = await fetch(`/api/stock-releases/${releaseId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, notes }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setReleaseApprovalDialog(null);
      setReleaseApprovalNotes("");
      toast({ title: t.requestDetail.actionDone });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const departmentsQuery = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/admin/departments"],
  });
  const warehousesQuery = useQuery<{ id: number; name: string; location: string | null }[]>({
    queryKey: ["/api/admin/warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/admin/warehouses", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const { data: salesReps } = useQuery<{ id: number; name: string; email: string; branchId: number | null }[]>({
    queryKey: ["/api/admin/sales-reps"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sales-reps", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const handleEditPOUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditUploadingPO(true);
    try {
      const formData = new FormData();
      formData.append("purchaseOrder", file);
      const res = await fetch("/api/upload/purchase-order", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      setEditPurchaseOrderFile(data.filePath);
      setEditPoFileName(file.name);
      toast({ title: t.requestCreate.fileUploaded, description: file.name });
    } catch (err: any) {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    } finally {
      setEditUploadingPO(false);
    }
  };

  const handleEditASUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditUploadingAS(true);
    try {
      const formData = new FormData();
      formData.append("accountStatement", file);
      const res = await fetch("/api/upload/account-statement", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      setEditAccountStatementFile(data.filePath);
      setEditAsFileName(file.name);
      toast({ title: t.requestCreate.fileUploaded, description: file.name });
    } catch (err: any) {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    } finally {
      setEditUploadingAS(false);
    }
  };

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editForm.items.some(i => i.itemCode && i.quantityRequested > 0)) {
        throw new Error(t.requestDetail.atLeastOneValid);
      }
      const validItems = editForm.items.filter(i => i.itemCode && i.quantityRequested > 0);
      if (validItems.some(i => i.lookupStatus !== "found")) {
        throw new Error(t.requestCreate.itemMustExist);
      }
      const isStrategicReq = (request as any).salesChannel === "strategic_reservation";
      const durNum = parseInt(editForm.reservationDuration || "0", 10);
      if (!isStrategicReq && durNum > 15) {
        const hasPayPath = !!(editForm.advancePayment && Number(editForm.advancePayment) > 0) && !!editAccountStatementFile;
        const hasPoPath = !!editPurchaseOrderFile;
        if (!hasPayPath && !hasPoPath) {
          throw new Error(isRTL
            ? "للحجوزات الأطول من 15 يوماً: يجب إرفاق (الدفعة المقدمة + كشف الحساب) أو (أمر الشراء)"
            : "For reservations longer than 15 days: either (Advance Payment + Account Statement) or (Purchase Order) is required");
        }
      }
      const res = await fetch(`/api/requests/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...editForm,
          requestDate: editForm.requestDate || undefined,
          advancePayment: editForm.advancePayment ? Number(editForm.advancePayment) : undefined,
          items: validItems,
          purchaseOrderFile: editPurchaseOrderFile || undefined,
          accountStatementFile: editAccountStatementFile || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setEditDialog(false);
      toast({ title: t.requestDetail.requestUpdated });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const extendMutation = useMutation({
    mutationFn: async ({ requestedDays, notes }: { requestedDays: number; notes?: string }) => {
      const res = await fetch(`/api/requests/${params.id}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestedDays, notes }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      setExtendDialog(false);
      setExtensionDays("");
      setExtensionNotes("");
      toast({ title: t.requestDetail.extensionSubmitted });
    },
    onError: (err: Error) => {
      const msg = err.message?.includes("pending extension")
        ? (isRTL ? "يوجد تمديد قيد المراجعة لهذا الطلب. يرجى الانتظار حتى يتم معالجته." : err.message)
        : err.message;
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    },
  });

  const extensionApprovalMutation = useMutation({
    mutationFn: async ({ extensionId, action, notes, newExpiryDate }: { extensionId: number; action: string; notes: string; newExpiryDate?: string }) => {
      const res = await fetch(`/api/extensions/${extensionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, notes, ...(newExpiryDate ? { newExpiryDate } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      setExtensionApprovalDialog(null);
      setExtensionApprovalNotes("");
      toast({ title: t.requestDetail.actionDone });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const markLostMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/requests/${params.id}/mark-lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: isRTL ? "تم تحويل الطلب إلى فرصة ضائعة" : "Request converted to lost opportunity" });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const markConfirmedLostMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/requests/${params.id}/mark-confirmed-lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: isRTL ? "تم تحويل الطلب إلى فرصة ضائعة مؤكدة" : "Request marked as confirmed lost opportunity" });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const updateEndDateMutation = useMutation({
    mutationFn: async ({ newEndDate, reason }: { newEndDate: string; reason: string }) => {
      const res = await fetch(`/api/requests/${params.id}/update-end-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newEndDate, reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests", params.id] });
      setEndDateDialog(false);
      setNewEndDate("");
      setEndDateReason("");
      toast({ title: isRTL ? "تم تحديث تاريخ الانتهاء" : "End date updated" });
    },
    onError: (err: Error) => {
      toast({ title: t.common.error, description: err.message, variant: "destructive" });
    },
  });

  const canEditEndDate = user && ["planning", "sector_head", "admin"].includes(user.role);

  const openEditDialog = () => {
    if (!request) return;
    setEditForm({
      department: request.department,
      customerName: request.customerName || "",
      customerAccountNumber: request.customerAccountNumber || "",
      projectName: request.projectName,
      requestDate: request.requestDate || "",
      reservationDuration: request.reservationDuration || "",
      reservationEndDate: request.reservationEndDate || "",
      advancePayment: request.advancePayment ? String(request.advancePayment) : "",
      salesRepId: request.salesRepId || null,
      sapReservationNumber: request.sapReservationNumber || "",
      notes: request.notes || "",
      items: request.items.map(i => ({
        itemCode: i.itemCode,
        productName: i.productName || "",
        itemDescription: i.itemDescription,
        brand: i.brand,
        quantityRequested: i.quantityRequested,
        warehouse: i.warehouse,
        sellingPrice: (i as any).sellingPrice || "",
        costPrice: (i as any).costPrice || "",
        lookupStatus: "found" as const,
      })),
    });
    setEditPurchaseOrderFile(request.purchaseOrderFile || "");
    setEditPoFileName(request.purchaseOrderFile ? request.purchaseOrderFile.split("/").pop() || "" : "");
    setEditAccountStatementFile(request.accountStatementFile || "");
    setEditAsFileName(request.accountStatementFile ? request.accountStatementFile.split("/").pop() || "" : "");
    setEditDialog(true);
  };

  const updateEditItem = (index: number, field: string, value: any) => {
    setEditForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addEditItem = () => {
    setEditForm(prev => ({
      ...prev,
      items: [...prev.items, { itemCode: "", productName: "", itemDescription: "", brand: "", quantityRequested: 0, warehouse: "", sellingPrice: "", costPrice: "", lookupStatus: "idle" as const }],
    }));
  };

  const removeEditItem = (index: number) => {
    setEditForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t.requestDetail.title} />
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t.requestDetail.notFound} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">{t.requestDetail.notFound}</p>
        </div>
      </div>
    );
  }

  const requestDuration = parseInt(request.reservationDuration || "0");
  const alreadyHasSectorHeadApproval = request.approvals?.some(
    (a: any) => a.role === "sector_head" && a.action === "approve"
  ) ?? false;
  const showApprovalActions = user && canApproveRequest(user.role as any, request.status as any, requestDuration, alreadyHasSectorHeadApproval, (request as any).salesChannel);
  const showEditAction = user && canEditRequest(user.role as any, request.status as any, request.createdBy === user.id);
  const isReservationExpired = (() => {
    if (!request.reservationEndDate) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const endDate = new Date(request.reservationEndDate); endDate.setHours(0, 0, 0, 0);
    return endDate.getTime() <= today.getTime();
  })();
  const showReleaseAction = user && canReleaseStock(user.role as any, request.status as any, (request as any).salesChannel) && !isReservationExpired;
  const hasReleasableItems = request.items.some(
    (i) => i.quantityRequested - i.quantityReleased > 0
  );
  const hasPendingRelease = request.stockReleases.some(
    (r) => !["final_approved", "rejected"].includes(r.status)
  );

  return (
    <div className="flex flex-col h-full">
      <Topbar title={`${t.requestDetail.request} #${request.requestNumber} - ${request.projectName}`} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Link href="/requests">
            <Button variant="ghost" size="sm" data-testid="button-back-requests">
              <BackArrow className="w-4 h-4" />
              <span>{t.requestDetail.back}</span>
            </Button>
          </Link>
        </div>

        {(request.status === "expired" || (request.status === "final_approved" && isReservationExpired && request.items?.some((i: any) => i.quantityRequested - i.quantityReleased > 0))) && (
          <Card className="border-destructive/60 bg-destructive/5" data-testid="alert-expired-request">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
              <div className="text-sm font-medium text-destructive flex-1 min-w-[200px]">
                {isRTL
                  ? "هذا الطلب منتهي — المواد الغير مصروفة رجعت للمخزون ولا يمكن الصرف"
                  : "This request has expired — unreleased items returned to inventory and stock release is no longer available"}
              </div>
              {request.status === "expired" && user && ["planning", "admin"].includes(user.role) && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={markLostMutation.isPending}
                  onClick={() => {
                    const msg = isRTL
                      ? "هل أنت متأكد من تحويل هذا الطلب إلى فرصة ضائعة؟ لا يمكن التراجع عن هذا الإجراء."
                      : "Are you sure you want to convert this request to Lost Opportunity? This action cannot be undone.";
                    if (window.confirm(msg)) {
                      markLostMutation.mutate();
                    }
                  }}
                  data-testid="button-mark-lost-opportunity"
                >
                  {isRTL ? "تحويل إلى فرصة ضائعة" : "Convert to Lost Opportunity"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {request.status === "lost_opportunity" && (
          <Card className="border-destructive/60 bg-destructive/5" data-testid="alert-lost-opportunity">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
              <div className="text-sm font-medium text-destructive flex-1 min-w-[200px]">
                {t.expiring.lostOpportunityAlert}
              </div>
              {user && ["planning", "admin"].includes(user.role) && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={markConfirmedLostMutation.isPending}
                  onClick={() => {
                    const msg = isRTL
                      ? "هل أنت متأكد من تحويل هذا الطلب إلى فرصة ضائعة مؤكدة؟ لا يمكن التراجع عن هذا الإجراء."
                      : "Are you sure you want to mark this request as Confirmed Lost Opportunity? This action cannot be undone.";
                    if (window.confirm(msg)) {
                      markConfirmedLostMutation.mutate();
                    }
                  }}
                  data-testid="button-mark-confirmed-lost"
                >
                  {isRTL ? "تأكيد الفرصة الضائعة" : "Confirm Lost Opportunity"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {request.status === "confirmed_lost_opportunity" && (
          <Card className="border-destructive/60 bg-destructive/5" data-testid="alert-confirmed-lost-opportunity">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
              <div className="text-sm font-medium text-destructive">
                {isRTL ? "هذا الطلب فرصة ضائعة مؤكدة" : "This request is a confirmed lost opportunity"}
              </div>
            </CardContent>
          </Card>
        )}

        {(() => {
          if (request.status !== "final_approved" || !request.reservationEndDate) return null;
          const hasUnreleased = request.items?.some((i: any) => i.quantityRequested - i.quantityReleased > 0);
          if (!hasUnreleased) return null;
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const endDate = new Date(request.reservationEndDate); endDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 3 || diffDays < -7) return null;
          const isExpired = diffDays <= 0;
          return (
            <Card className="border-destructive/60 bg-destructive/5" data-testid="alert-expiring-request">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 animate-pulse" />
                <div className="text-sm font-medium text-destructive">
                  {isExpired
                    ? t.expiring.expiredAlert
                    : `${t.expiring.expiringAlert} ${diffDays} ${diffDays === 1 ? t.expiring.dayRemaining : t.expiring.daysRemaining}`
                  }
                  {" — "}
                  {t.expiring.unreleased}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-semibold" data-testid="text-detail-request-number">
                #{request.requestNumber}
              </h2>
              <Badge variant={getStatusVariant(request.status as any)} data-testid="badge-request-status">
                {getDisplayStatus(request.status, (request as any).salesChannel, isRTL, t)}
              </Badge>
              {(() => {
                const isStrategic = (request as any).salesChannel === "strategic_reservation";
                const status = request.status;
                let nextLabel: string | null = null;

                if (status === "submitted") {
                  nextLabel = isRTL ? "⟳ بانتظار موافقة مدير الفرع" : "⟳ Awaiting Branch Manager";
                } else if (status === "branch_approved") {
                  nextLabel = isRTL ? "⟳ بانتظار موافقة مدير الصنف" : "⟳ Awaiting Category Manager";
                } else if (status === "category_approved") {
                  if (isStrategic) {
                    nextLabel = isRTL ? "⟳ بانتظار موافقة مدير القطاع" : "⟳ Awaiting Sector Head";
                  } else if (requestDuration > 90 && !alreadyHasSectorHeadApproval) {
                    nextLabel = isRTL ? "⟳ بانتظار موافقة مدير القطاع" : "⟳ Awaiting Sector Head";
                  } else {
                    nextLabel = isRTL ? "⟳ بانتظار موافقة التخطيط" : "⟳ Awaiting Planning";
                  }
                }

                return nextLabel ? (
                  <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 text-xs" data-testid="badge-next-approver">
                    {nextLabel}
                  </Badge>
                ) : null;
              })()}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <UserIcon className="w-3.5 h-3.5" />
                {request.creator?.name}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatDateTime(request.createdAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(user?.role === "planning" || user?.role === "admin" || (user?.role === "sales_rep" && request.createdBy === user?.id && request.status === "submitted")) && (
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={() => setDeleteDialog(true)}
                data-testid="button-delete-request"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                <span>{isRTL ? "حذف الطلب" : "Delete Request"}</span>
              </Button>
            )}
            {showEditAction && (
              <Button
                variant={request.status === "rejected" && user?.role === "sales_rep" ? "default" : "outline"}
                size="sm"
                onClick={openEditDialog}
                data-testid="button-edit-request"
              >
                <Edit3 className="w-4 h-4" />
                <span>
                  {request.status === "rejected" && user?.role === "sales_rep"
                    ? t.requestDetail.editAndResubmit
                    : t.requestDetail.editRequest}
                </span>
              </Button>
            )}
            {showApprovalActions && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setApprovalDialog("approve")}
                  data-testid="button-approve"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{t.requestDetail.approveBtn}</span>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setApprovalDialog("reject")}
                  data-testid="button-reject"
                >
                  <XCircle className="w-4 h-4" />
                  <span>{t.requestDetail.rejectBtn}</span>
                </Button>
              </>
            )}
            {showReleaseAction && hasReleasableItems && hasPendingRelease && (
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-md px-3 py-2" data-testid="notice-pending-release">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  {isRTL
                    ? "يوجد طلب صرف قيد المعالجة — لا يمكن تقديم طلب صرف جديد حتى يكتمل صرف الطلب الحالي أو يُرفض"
                    : "A stock release is in progress — you cannot submit a new one until the current release is completed or rejected"}
                </span>
              </div>
            )}
            {showReleaseAction && hasReleasableItems && !hasPendingRelease && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingReleaseId(null);
                    setReleaseDialog("full");
                    setReleaseNotes("");
                  }}
                  data-testid="button-release-full"
                >
                  <Package className="w-4 h-4" />
                  <span>{t.requestDetail.fullRelease}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingReleaseId(null);
                    const initial: Record<number, number> = {};
                    request.items.forEach((i) => {
                      initial[i.id] = 0;
                    });
                    setReleaseItems(initial);
                    setReleaseNotes("");
                    setReleaseDialog("partial");
                  }}
                  data-testid="button-release-partial"
                >
                  <Truck className="w-4 h-4" />
                  <span>{t.requestDetail.partialRelease}</span>
                </Button>
              </>
            )}
            {(() => {
              if (!["final_approved", "expired"].includes(request.status)) return null;
              const hasUnreleased = request.items.some((i: RequestItem) => i.quantityReleased < i.quantityRequested);
              if (!hasUnreleased) return null;
              if (!request.reservationEndDate) return null;
              const endDate = new Date(request.reservationEndDate);
              const now = new Date();
              const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              if (daysLeft > 3) return null;
              const pendingStatuses = ["pending_branch", "pending_category", "pending_planning", "pending_sector_head"];
              const hasPendingExtension = request.extensions?.some((e: any) => pendingStatuses.includes(e.status));
              if (hasPendingExtension) {
                return (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                    <Clock className="w-3 h-3 mr-1" />
                    {isRTL ? "يوجد تمديد قيد المراجعة" : "Extension pending review"}
                  </Badge>
                );
              }
              return (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setExtensionDays("");
                    setExtensionNotes("");
                    setExtendDialog(true);
                  }}
                  data-testid="button-extend-date"
                >
                  <Calendar className="w-4 h-4" />
                  <span>{t.requestDetail.extendReservation}</span>
                </Button>
              );
            })()}
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold">{t.requestDetail.requestInfo}</h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div className="flex items-start gap-2">
                <Tag className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">{t.requestDetail.customerAccountNumber}</p>
                  <p className="font-medium">{request.customerAccountNumber || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <UserIcon className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">{t.requestDetail.customerName}</p>
                  <p className="font-medium" data-testid="text-customer-name">{request.customerName || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <FolderOpen className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">{t.requestDetail.project}</p>
                  <p className="font-medium" data-testid="text-project-name">{request.projectName}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Building2 className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">{t.requestDetail.departmentLabel}</p>
                  <p className="font-medium" data-testid="text-department">{request.department}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">{t.requestDetail.requestDateLabel}</p>
                  <p className="font-medium" data-testid="text-request-date">{request.requestDate}</p>
                </div>
              </div>
              {(request as any).salesChannel === "strategic_reservation" && (
                <div className="flex items-start gap-2">
                  <Tag className="w-4 h-4 mt-0.5 text-purple-500 flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{isRTL ? "قناة البيع" : "Sales Channel"}</p>
                    <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">{isRTL ? "حجز استراتيجي" : "Strategic Reservation"}</Badge>
                  </div>
                </div>
              )}
              {request.salesRep && (
                <div className="flex items-start gap-2">
                  <UserIcon className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.requestDetail.salesRepLabel}</p>
                    <p className="font-medium" data-testid="text-sales-rep">{request.salesRep.name}</p>
                  </div>
                </div>
              )}
              {request.reservationDuration && (
                <div className="flex items-start gap-2">
                  <Clock className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.requestDetail.durationLabel}</p>
                    <p className="font-medium" data-testid="text-reservation-duration">{request.reservationDuration} {t.requestDetail.days}</p>
                  </div>
                </div>
              )}
              {request.reservationEndDate && (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Calendar className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs">{t.requestDetail.endDateLabel}</p>
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium" data-testid="text-reservation-end-date">{request.reservationEndDate}</p>
                        {canEditEndDate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                            onClick={() => { setNewEndDate(request.reservationEndDate || ""); setEndDateReason(""); setEndDateDialog(true); }}
                            data-testid="button-edit-end-date"
                          >
                            <Edit3 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {request.advancePayment && (
                <div className="flex items-start gap-2">
                  <Tag className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.requestDetail.advancePaymentLabel}</p>
                    <p className="font-medium">{Number(request.advancePayment).toLocaleString()} {t.requestDetail.sar}</p>
                  </div>
                </div>
              )}
              {request.sapReservationNumber && (
                <div className="flex items-start gap-2">
                  <Tag className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.requestDetail.sapReservationNumber}</p>
                    <p className="font-medium" data-testid="text-sap-reservation-number">{request.sapReservationNumber}</p>
                  </div>
                </div>
              )}
              {request.purchaseOrderFile && (
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.requestCreate.purchaseOrder}</p>
                    <a 
                      href={`${buildFileUrl(request.purchaseOrderFile)}${token ? `?token=${token}` : ""}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      {t.stockReleases.viewRequest}
                    </a>
                  </div>
                </div>
              )}
              {request.accountStatementFile && (
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.requestCreate.accountStatement}</p>
                    <a 
                      href={`${buildFileUrl(request.accountStatementFile)}${token ? `?token=${token}` : ""}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      {t.stockReleases.viewRequest}
                    </a>
                  </div>
                </div>
              )}
              {request.notes && (
                <div className="flex items-start gap-2 sm:col-span-2 lg:col-span-3">
                  <Edit3 className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">{t.requestDetail.notesLabel}</p>
                    <p className="font-medium">{request.notes}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold">{t.requestDetail.productsSection} ({request.items.length})</h3>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto" style={{ maxHeight: request.items.length > 5 ? "480px" : "none", overflowY: request.items.length > 5 ? "auto" : "visible" }}>
              <table className="w-full text-sm" data-testid="table-products">
                <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-right py-2 pl-4 font-medium">{t.requestDetail.code}</th>
                    <th className="text-right py-2 px-2 font-medium">{t.requestDetail.description}</th>
                    <th className="text-right py-2 px-2 font-medium">{t.requestDetail.brandCol}</th>
                    <th className="text-left py-2 px-2 font-medium">{t.requestDetail.qtyRequested}</th>
                    <th className="text-left py-2 px-2 font-medium">{t.requestDetail.sellingPriceCol}</th>
                    {(user?.role === "planning" || user?.role === "admin" || user?.role === "category_manager" || user?.role === "sector_head") && (
                      <th className="text-left py-2 px-2 font-medium">{t.requestDetail.costPriceCol}</th>
                    )}
                    <th className="text-left py-2 px-2 font-medium">{t.requestDetail.qtyReleased}</th>
                    <th className="text-left py-2 px-2 font-medium">{t.requestDetail.releasedSalesTotal}</th>
                    <th className="text-left py-2 px-2 font-medium">{t.requestDetail.remaining}</th>
                    <th className="text-left py-2 px-2 font-medium">{t.requestDetail.remainingSalesTotal}</th>
                    <th className="text-right py-2 px-2 font-medium">{t.requestDetail.warehouseCol}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t.requestDetail.statusCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {request.items.map((item) => {
                    const remaining = item.quantityRequested - item.quantityReleased;
                    const progress = item.quantityRequested > 0
                      ? (item.quantityReleased / item.quantityRequested) * 100
                      : 0;
                    const isNew = (item as any).isNewItem;
                    const changedFrom = (item as any).quantityChangedFrom;
                    const isModified = changedFrom !== null && changedFrom !== undefined;
                    const rowBg = isNew
                      ? "bg-emerald-50 dark:bg-emerald-950/20"
                      : isModified
                      ? "bg-amber-50 dark:bg-amber-950/20"
                      : "";
                    return (
                      <tr key={item.id} className={`border-b last:border-0 ${rowBg}`} data-testid={`row-item-${item.id}`}>
                        <td className="py-3 pl-4">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-xs font-mono">
                              {item.itemCode}
                            </Badge>
                            {isNew && (
                              <span className="text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">
                                {isRTL ? "جديد" : "New"}
                              </span>
                            )}
                            {isModified && (
                              <span className="text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                                {isRTL ? "معدّل" : "Modified"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <span className="font-medium">{item.itemDescription}</span>
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">{item.brand}</td>
                        <td className="text-left py-3 px-2 tabular-nums">
                          {isModified ? (
                            <div className="flex flex-col">
                              <span className="font-semibold text-amber-600 dark:text-amber-400">{item.quantityRequested}</span>
                              <span className="text-xs text-muted-foreground line-through">{changedFrom}</span>
                            </div>
                          ) : (
                            item.quantityRequested
                          )}
                        </td>
                        <td className="text-left py-3 px-2 tabular-nums">
                          {(item as any).sellingPrice ? parseFloat((item as any).sellingPrice).toLocaleString() : "—"}
                        </td>
                        {(user?.role === "planning" || user?.role === "admin" || user?.role === "category_manager" || user?.role === "sector_head") && (
                          <td className="text-left py-3 px-2 tabular-nums">
                            {(item as any).costPrice ? parseFloat((item as any).costPrice).toLocaleString() : "—"}
                          </td>
                        )}
                        <td className="text-left py-3 px-2 tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{item.quantityReleased}</td>
                        <td className="text-left py-3 px-2 tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                          {(item as any).sellingPrice ? (item.quantityReleased * parseFloat((item as any).sellingPrice)).toLocaleString() : "—"}
                        </td>
                        <td className="text-left py-3 px-2 tabular-nums font-medium text-amber-600 dark:text-amber-400">{remaining}</td>
                        <td className="text-left py-3 px-2 tabular-nums font-medium text-amber-600 dark:text-amber-400">
                          {(item as any).sellingPrice ? (remaining * parseFloat((item as any).sellingPrice)).toLocaleString() : "—"}
                        </td>
                        <td className="py-3 px-2">
                          <span className="font-medium text-foreground">{item.warehouse}</span>
                          {(() => {
                            const wh = warehousesQuery.data?.find(w => w.name === item.warehouse);
                            return wh?.location ? (
                              <p className="text-xs text-muted-foreground mt-0.5">{isRTL ? "الموقع:" : "Loc:"} {wh.location}</p>
                            ) : null;
                          })()}
                        </td>
                        <td className="text-left py-3 pr-4">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`text-xs font-medium ${getItemStatusColor(item.status as any)}`}>
                              {itemStatusLabels[item.status as keyof typeof itemStatusLabels]}
                            </span>
                            <Progress value={progress} className="w-16 h-1.5" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card shadow-[0_-2px_0_0_hsl(var(--border))]">
                  <tr className="font-semibold bg-muted/40">
                    <td className="py-3 pl-4" colSpan={3}>
                      <span className="text-sm">{isRTL ? "الإجمالي" : "Total"}</span>
                    </td>
                    <td className="text-left py-3 px-2 tabular-nums text-sm">
                      {request.items.reduce((sum, i) => sum + i.quantityRequested, 0).toLocaleString()}
                    </td>
                    <td className="text-left py-3 px-2 tabular-nums text-sm">
                      {request.items.reduce((sum, i) => sum + ((i as any).sellingPrice ? parseFloat((i as any).sellingPrice) * i.quantityRequested : 0), 0).toLocaleString()}
                    </td>
                    {(user?.role === "planning" || user?.role === "admin" || user?.role === "category_manager" || user?.role === "sector_head") && (
                      <td className="text-left py-3 px-2 tabular-nums text-sm">
                        {request.items.reduce((sum, i) => sum + ((i as any).costPrice ? parseFloat((i as any).costPrice) * i.quantityRequested : 0), 0).toLocaleString()}
                      </td>
                    )}
                    <td className="text-left py-3 px-2 tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
                      {request.items.reduce((sum, i) => sum + i.quantityReleased, 0).toLocaleString()}
                    </td>
                    <td className="text-left py-3 px-2 tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
                      {request.items.reduce((sum, i) => sum + (i.quantityReleased * ((i as any).sellingPrice ? parseFloat((i as any).sellingPrice) : 0)), 0).toLocaleString()}
                    </td>
                    <td className="text-left py-3 px-2 tabular-nums text-sm text-amber-600 dark:text-amber-400">
                      {request.items.reduce((sum, i) => sum + (i.quantityRequested - i.quantityReleased), 0).toLocaleString()}
                    </td>
                    <td className="text-left py-3 px-2 tabular-nums text-sm text-amber-600 dark:text-amber-400">
                      {request.items.reduce((sum, i) => sum + ((i.quantityRequested - i.quantityReleased) * ((i as any).sellingPrice ? parseFloat((i as any).sellingPrice) : 0)), 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-2"></td>
                    <td className="py-3 pr-4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <h3 className="text-sm font-semibold">{t.requestDetail.approvalTrail}</h3>
            </CardHeader>
            <CardContent>
              {request.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t.requestDetail.noApprovalsYet}</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                  {request.approvals.map((approval, index) => (
                    <div key={approval.id} className="flex gap-3" data-testid={`timeline-approval-${approval.id}`}>
                      <div className="flex flex-col items-center">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                          approval.action === "approve" ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" :
                          approval.action === "reject" ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" :
                          "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        }`}>
                          {approval.action === "approve" ? <CheckCircle className="w-3.5 h-3.5" /> :
                           approval.action === "reject" ? <XCircle className="w-3.5 h-3.5" /> :
                           <Edit3 className="w-3.5 h-3.5" />}
                        </div>
                        {index < request.approvals.length - 1 && (
                          <div className="w-px h-full bg-border mt-1" />
                        )}
                      </div>
                      <div className="min-w-0 pb-4">
                        <p className="text-sm font-medium">
                          {actionLabels[approval.action as keyof typeof actionLabels]} {t.requestDetail.byUser} {approval.user?.name ?? t.dashboard.unknown}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {roleLabels[approval.role as keyof typeof roleLabels]} · {formatDateTime(approval.createdAt)}
                        </p>
                        {approval.notes && (() => {
                          try {
                            const parsed = JSON.parse(approval.notes);
                            if (parsed.type === "edit") {
                              const hasDiff = parsed.diff?.length > 0 || parsed.itemChanges?.length > 0;
                              return (
                                <div className="mt-2 space-y-2">
                                  {parsed.message && (
                                    <p className="text-xs text-muted-foreground italic">"{parsed.message}"</p>
                                  )}
                                  {hasDiff && (
                                    <div className="border rounded-md overflow-hidden text-xs">
                                      {parsed.diff?.length > 0 && (
                                        <>
                                          <div className="bg-muted/50 px-2 py-1 font-medium text-muted-foreground">{isRTL ? "تفاصيل التعديل" : "Edit Details"}</div>
                                          <table className="w-full">
                                            <thead>
                                              <tr className="border-b bg-muted/30">
                                                <th className="text-right px-2 py-1 text-muted-foreground font-medium">{isRTL ? "الحقل" : "Field"}</th>
                                                <th className="text-right px-2 py-1 text-red-500 font-medium">{isRTL ? "القيمة السابقة" : "Before"}</th>
                                                <th className="text-right px-2 py-1 text-emerald-600 font-medium">{isRTL ? "القيمة الجديدة" : "After"}</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {parsed.diff.map((f: any, i: number) => (
                                                <tr key={i} className="border-b last:border-0">
                                                  <td className="px-2 py-1 font-medium">{isRTL ? f.fieldAr : f.fieldEn}</td>
                                                  <td className="px-2 py-1 text-red-500 line-through">{f.oldValue || "-"}</td>
                                                  <td className="px-2 py-1 text-emerald-600 font-medium">{f.newValue || "-"}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </>
                                      )}
                                      {parsed.itemChanges?.length > 0 && (
                                        <>
                                          <div className="bg-muted/50 px-2 py-1 font-medium text-muted-foreground border-t">{isRTL ? "تغييرات الأصناف" : "Item Changes"}</div>
                                          <table className="w-full">
                                            <tbody>
                                              {parsed.itemChanges.map((ic: any, i: number) => (
                                                <tr key={i} className="border-b last:border-0">
                                                  <td className="px-2 py-1 font-mono text-muted-foreground">{ic.itemCode}</td>
                                                  <td className="px-2 py-1">{ic.description}</td>
                                                  <td className="px-2 py-1 font-medium">
                                                    {ic.action === "added" && <span className="text-emerald-600">{isRTL ? `✦ مضاف (${ic.qty})` : `✦ Added (${ic.qty})`}</span>}
                                                    {ic.action === "removed" && <span className="text-red-500">{isRTL ? `✕ محذوف (${ic.oldQty})` : `✕ Removed (${ic.oldQty})`}</span>}
                                                    {ic.action === "modified" && <span className="text-amber-600">{isRTL ? `${ic.oldQty} ← ${ic.newQty}` : `${ic.oldQty} → ${ic.newQty}`}</span>}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            }
                          } catch {}
                          return <p className="text-xs text-muted-foreground mt-1 italic">"{approval.notes}"</p>;
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <h3 className="text-sm font-semibold">{t.requestDetail.releaseOperations} ({request.stockReleases.length})</h3>
            </CardHeader>
            <CardContent>
              {request.stockReleases.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t.requestDetail.noReleasesYet}</p>
              ) : (
                <div className="space-y-4">
                  {request.stockReleases.map((release) => {
                    const canApproveThis = user && canApproveStockRelease(user.role as any, release.status);
                    return (
                      <div key={release.id} className="border rounded-md p-3" data-testid={`card-release-${release.id}`}>
                        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">{t.requestDetail.release} #{release.id}</span>
                            <Badge variant={getStockReleaseStatusVariant(release.status)}>
                              {stockReleaseStatusLabels[release.status] || release.status}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {(release as any).releaseType === "full" ? t.requestDetail.full : t.requestDetail.partial}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDateTime(release.createdAt)}</span>
                        </div>
                        <div className="space-y-1">
                          {release.items.map((ri) => (
                            <div key={ri.id} className="flex items-center justify-between text-sm">
                              <span className="font-bold text-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">{ri.requestItem?.itemCode}</span>
                              <Badge variant="secondary" className="text-xs">{ri.quantity} {t.requestDetail.unit}</Badge>
                            </div>
                          ))}
                        </div>
                        {release.notes && (
                          <p className="text-xs text-muted-foreground mt-2 italic">"{release.notes}"</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{t.requestDetail.byUser} {release.creator?.name}</p>

                        <div className="flex items-center gap-2 mt-3 pt-2 border-t flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => exportReleaseToExcel(release, request.id, warehousesQuery.data || [])}
                            data-testid={`button-export-release-${release.id}`}
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{isRTL ? "تحميل بيانات الصرف" : "Download Release Data"}</span>
                          </Button>
                          {canApproveThis && (
                            <>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => setReleaseApprovalDialog({ releaseId: release.id, action: "approve" })}
                                data-testid={`button-approve-release-${release.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span>{t.requestDetail.approveBtn}</span>
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setReleaseApprovalDialog({ releaseId: release.id, action: "reject" })}
                                data-testid={`button-reject-release-${release.id}`}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>{t.requestDetail.rejectBtn}</span>
                              </Button>
                            </>
                          )}
                          {user && release.status === "submitted" && (release.createdBy === user.id || user.role === "admin") && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingReleaseId(release.id);
                                  setReleaseNotes(release.notes || "");
                                  if ((release as any).releaseType === "partial") {
                                    const initial: Record<number, number> = {};
                                    request.items.forEach((i) => { initial[i.id] = 0; });
                                    release.items.forEach((ri: any) => { initial[ri.requestItemId] = ri.quantity; });
                                    setReleaseItems(initial);
                                    setReleaseDialog("partial");
                                  } else {
                                    setReleaseDialog("full");
                                  }
                                }}
                                data-testid={`button-edit-release-${release.id}`}
                              >
                                <span>{isRTL ? "تعديل" : "Edit"}</span>
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={deleteReleaseMutation.isPending}
                                onClick={() => {
                                  const msg = isRTL
                                    ? "هل أنت متأكد من حذف طلب الصرف هذا؟"
                                    : "Are you sure you want to delete this stock release?";
                                  if (window.confirm(msg)) {
                                    deleteReleaseMutation.mutate(release.id);
                                  }
                                }}
                                data-testid={`button-delete-release-${release.id}`}
                              >
                                <span>{isRTL ? "حذف" : "Delete"}</span>
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {request.extensions && request.extensions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <h3 className="text-sm font-semibold">{t.requestDetail.extensionHistory}</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {request.extensions.map((ext) => (
                  <div key={ext.id} className="p-3 rounded-md border space-y-2" data-testid={`extension-${ext.id}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {ext.requestedDays} {t.requestDetail.extensionDays}
                        </span>
                      </div>
                      <Badge variant={getExtensionStatusVariant(ext.status)} data-testid={`extension-status-${ext.id}`}>
                        {(t as any).extensionStatuses?.[ext.status] || ext.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div className="flex justify-between gap-2 flex-wrap">
                        <span>{t.requestDetail.extensionPreviousExpiry}:</span>
                        <span>{ext.previousExpiryDate}</span>
                      </div>
                      <div className="flex justify-between gap-2 flex-wrap">
                        <span>{t.requestDetail.extensionNewExpiry}:</span>
                        <span>{ext.newExpiryDate}</span>
                      </div>
                      <div className="flex justify-between gap-2 flex-wrap">
                        <span>{t.requestDetail.extensionTotalDays}:</span>
                        <span>{ext.totalDaysFromCreation}</span>
                      </div>
                      {ext.totalDaysFromCreation > 90 && (
                        <div className="text-amber-600 dark:text-amber-400 text-xs">
                          {isRTL ? "يتطلب موافقة مدير القطاع" : "Requires Sector Head approval"}
                        </div>
                      )}
                      {ext.notes && (
                        <div className="pt-1">
                          <span className="text-muted-foreground">{t.requestDetail.extensionNotes}: </span>
                          <span>{ext.notes}</span>
                        </div>
                      )}
                      {ext.rejectionReason && (
                        <div className="pt-1 text-destructive">
                          <span>{isRTL ? "سبب الرفض" : "Rejection reason"}: </span>
                          <span>{ext.rejectionReason}</span>
                        </div>
                      )}
                      <div className="pt-1">
                        <span>{isRTL ? "بواسطة" : "By"}: </span>
                        <span className="font-medium">{(ext as any).requestedByUser?.name || ""}</span>
                        <span className="mx-2">-</span>
                        <span>{formatDateTime(ext.createdAt)}</span>
                      </div>
                    </div>
                    {user && canApproveExtension(user.role as any, ext.status) && ext.status !== "approved" && ext.status !== "rejected" && (
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setExtensionApprovalNotes("");
                            setExtensionEditedDate(ext.newExpiryDate);
                            setExtensionApprovalDialog({ extensionId: ext.id, action: "approve", originalNewExpiryDate: ext.newExpiryDate, previousExpiryDate: ext.previousExpiryDate });
                          }}
                          data-testid={`button-approve-extension-${ext.id}`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          {t.requestDetail.extensionApprove}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setExtensionApprovalNotes("");
                            setExtensionEditedDate(ext.newExpiryDate);
                            setExtensionApprovalDialog({ extensionId: ext.id, action: "reject", originalNewExpiryDate: ext.newExpiryDate, previousExpiryDate: ext.previousExpiryDate });
                          }}
                          data-testid={`button-reject-extension-${ext.id}`}
                        >
                          <X className="w-3.5 h-3.5" />
                          {t.requestDetail.extensionReject}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold">{t.requestDetail.auditLogSection}</h3>
          </CardHeader>
          <CardContent>
            {request.auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t.requestDetail.noLogs}</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {request.auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 text-sm py-2 border-b last:border-0" data-testid={`audit-log-${log.id}`}>
                    <Clock className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p>
                        <span className="font-medium">{log.user?.name}</span>{" "}
                        <span className="text-muted-foreground">
                          {log.action.includes("approved stock release") ? t.requestDetail.approveRelease : 
                           log.action.includes("rejected stock release") ? t.requestDetail.rejectRelease :
                           log.action.includes("requested stock release") ? t.requestDetail.submitRelease :
                           log.action.includes("edited stock release") ? (isRTL ? "عدّل طلب الصرف" : "edited stock release") :
                           log.action.includes("deleted stock release") ? (isRTL ? "حذف طلب الصرف" : "deleted stock release") :
                           log.action.includes("auto-approved strategic stock release") ? (isRTL ? "اعتماد تلقائي لصرف استراتيجي" : "auto-approved strategic stock release") :
                           log.action.includes("auto_closed_fully_released") ? (isRTL ? "أُغلق الطلب تلقائياً (صُرف بالكامل)" : "auto-closed (fully released)") :
                           log.action.includes("manual_mark_confirmed_lost_opportunity") ? (isRTL ? "أكّد الفرصة الضائعة" : "confirmed lost opportunity") :
                           log.action.includes("manual_mark_lost_opportunity") ? (isRTL ? "حوّل الطلب إلى فرصة ضائعة يدوياً" : "manually converted to lost opportunity") :
                           log.action.includes("update_end_date") ? (isRTL ? "حدّث تاريخ انتهاء الحجز" : "updated reservation end date") :
                           log.action.includes("approved") ? t.requestDetail.approveRequest : 
                           log.action.includes("rejected") ? t.requestDetail.rejectRequest : 
                           log.action.includes("submitted") ? t.requestCreate.submitRequest :
                           log.action.includes("updated") ? t.requestDetail.requestUpdated :
                           log.action.includes("created") ? t.requestCreate.submitRequest :
                           log.action}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={approvalDialog !== null} onOpenChange={() => setApprovalDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approvalDialog === "approve" ? t.requestDetail.approveRequest : t.requestDetail.rejectRequest}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder={t.requestDetail.addNotesOptional}
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
              className="resize-none"
              data-testid="input-approval-notes"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalDialog(null)}>{t.requestDetail.confirmCancel}</Button>
            <Button
              variant={approvalDialog === "reject" ? "destructive" : "default"}
              onClick={() => {
                if (approvalDialog) {
                  approvalMutation.mutate({ action: approvalDialog, notes: approvalNotes });
                }
              }}
              disabled={approvalMutation.isPending}
              data-testid="button-confirm-approval"
            >
              {approvalMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{approvalDialog === "approve" ? t.requestDetail.approveBtn : t.requestDetail.rejectBtn}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseDialog === "full"} onOpenChange={(open) => { if (!open) { setReleaseDialog(null); setEditingReleaseId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingReleaseId ? (isRTL ? "تعديل طلب الصرف الكامل" : "Edit Full Release") : t.requestDetail.fullReleaseTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t.requestDetail.fullReleaseDesc}
            </p>
            <div className="max-h-[400px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {request?.items.map((item) => {
                const remaining = item.quantityRequested - item.quantityReleased;
                if (remaining <= 0) return null;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-muted/50 border border-transparent hover:border-border transition-colors" data-testid={`full-release-item-${item.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.itemDescription || item.productName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-bold text-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 inline-block mb-1">{item.itemCode}</span>
                        {item.warehouse && (
                          <span className="font-medium text-foreground bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900/50 inline-block mb-1 ms-1">{t.requestDetail.warehouseCol}: {item.warehouse}</span>
                        )}
                        <br />
                        {t.requestDetail.requested}: {item.quantityRequested} · {t.requestDetail.released}: {item.quantityReleased} · {t.requestDetail.remainingQty}: <span className="font-bold text-orange-600 dark:text-orange-400">{remaining}</span>
                      </p>
                    </div>
                    <Badge variant="secondary" className="font-bold px-3 py-1 text-sm">{remaining} {t.requestDetail.unit}</Badge>
                  </div>
                );
              })}
            </div>
            <div className="pt-2 border-t">
              <Textarea
                placeholder={t.requestDetail.notesOptional}
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                className="resize-none"
                data-testid="input-full-release-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReleaseDialog(null); setEditingReleaseId(null); }}>{t.requestDetail.confirmCancel}</Button>
            <Button
              onClick={() => releaseMutation.mutate()}
              disabled={releaseMutation.isPending}
              data-testid="button-confirm-full-release"
            >
              {releaseMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{editingReleaseId ? (isRTL ? "حفظ التعديلات" : "Save Changes") : t.requestDetail.submitRelease}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseDialog === "partial"} onOpenChange={(open) => { if (!open) { setReleaseDialog(null); setEditingReleaseId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingReleaseId ? (isRTL ? "تعديل طلب الصرف الجزئي" : "Edit Partial Release") : t.requestDetail.partialReleaseTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t.requestDetail.partialReleaseDesc}
            </p>
            <div className="max-h-[400px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {request?.items.map((item) => {
                const remaining = item.quantityRequested - item.quantityReleased;
                if (remaining <= 0) return null;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-muted/50 border border-transparent hover:border-border transition-colors" data-testid={`release-item-${item.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.itemDescription || item.productName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-bold text-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 inline-block mb-1">{item.itemCode}</span>
                        {item.warehouse && (
                          <span className="font-medium text-foreground bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900/50 inline-block mb-1 ms-1">{t.requestDetail.warehouseCol}: {item.warehouse}</span>
                        )}
                        <br />
                        {t.requestDetail.requested}: {item.quantityRequested} · {t.requestDetail.released}: {item.quantityReleased} · {t.requestDetail.remainingQty}: <span className="font-bold text-orange-600 dark:text-orange-400">{remaining}</span>
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={remaining}
                      value={releaseItems[item.id] || 0}
                      onChange={(e) => {
                        const val = Math.min(Math.max(0, Number(e.target.value)), remaining);
                        setReleaseItems({ ...releaseItems, [item.id]: val });
                      }}
                      className="w-24 font-bold"
                      data-testid={`input-release-qty-${item.id}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="pt-2 border-t">
              <Textarea
                placeholder={t.requestDetail.notesOptional}
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                className="resize-none"
                data-testid="input-release-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReleaseDialog(null); setEditingReleaseId(null); }}>{t.requestDetail.confirmCancel}</Button>
            <Button
              onClick={() => releaseMutation.mutate()}
              disabled={releaseMutation.isPending}
              data-testid="button-confirm-partial-release"
            >
              {releaseMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{editingReleaseId ? (isRTL ? "حفظ التعديلات" : "Save Changes") : t.requestDetail.submitRelease}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseApprovalDialog !== null} onOpenChange={() => setReleaseApprovalDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {releaseApprovalDialog?.action === "approve" ? t.requestDetail.approveRelease : t.requestDetail.rejectRelease}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder={t.requestDetail.addNotesOptional}
              value={releaseApprovalNotes}
              onChange={(e) => setReleaseApprovalNotes(e.target.value)}
              className="resize-none"
              data-testid="input-release-approval-notes"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseApprovalDialog(null)}>{t.requestDetail.confirmCancel}</Button>
            <Button
              variant={releaseApprovalDialog?.action === "reject" ? "destructive" : "default"}
              onClick={() => {
                if (releaseApprovalDialog) {
                  releaseApprovalMutation.mutate({
                    releaseId: releaseApprovalDialog.releaseId,
                    action: releaseApprovalDialog.action,
                    notes: releaseApprovalNotes,
                  });
                }
              }}
              disabled={releaseApprovalMutation.isPending}
              data-testid="button-confirm-release-approval"
            >
              {releaseApprovalMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{releaseApprovalDialog?.action === "approve" ? t.requestDetail.approveBtn : t.requestDetail.rejectBtn}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={extendDialog} onOpenChange={setExtendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.requestDetail.extendReservation}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>{t.requestDetail.extensionDuration}</Label>
              <Select value={extensionDays} onValueChange={setExtensionDays}>
                <SelectTrigger data-testid="select-extension-days">
                  <SelectValue placeholder={t.requestDetail.extensionDuration} />
                </SelectTrigger>
                <SelectContent>
                  {[7, 15, 30, 45, 75, 90].map(d => (
                    <SelectItem key={d} value={String(d)}>
                      {d} {t.requestDetail.extensionDays}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.requestDetail.extensionNotes}</Label>
              <Textarea
                value={extensionNotes}
                onChange={(e) => setExtensionNotes(e.target.value)}
                data-testid="input-extension-notes"
              />
            </div>
            {extensionDays && request?.reservationEndDate && (() => {
              const prevDate = new Date(request.reservationEndDate);
              const newDate = new Date(prevDate);
              newDate.setDate(newDate.getDate() + Number(extensionDays));
              const creationDate = new Date(request.createdAt);
              const totalDays = Math.ceil((newDate.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24));
              return (
                <div className="p-3 rounded-md bg-muted text-sm space-y-1">
                  <div className="flex justify-between gap-2 flex-wrap">
                    <span className="text-muted-foreground">{t.requestDetail.extensionNewExpiry}:</span>
                    <span className="font-medium">{newDate.toISOString().split("T")[0]}</span>
                  </div>
                  <div className="flex justify-between gap-2 flex-wrap">
                    <span className="text-muted-foreground">{t.requestDetail.extensionTotalDays}:</span>
                    <span className="font-medium">{totalDays}</span>
                  </div>
                  {totalDays > 90 && (
                    <div className="mt-2 p-2 rounded bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs">
                      {isRTL ? "سيتطلب موافقة مدير القطاع (أكثر من 90 يوم)" : "Requires Sector Head approval (>90 days)"}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendDialog(false)} data-testid="button-cancel-extend">
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => extendMutation.mutate({ requestedDays: Number(extensionDays), notes: extensionNotes || undefined })}
              disabled={extendMutation.isPending || !extensionDays}
              data-testid="button-confirm-extend"
            >
              {extendMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {t.requestDetail.extensionRequested}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extensionApprovalDialog} onOpenChange={() => setExtensionApprovalDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {extensionApprovalDialog?.action === "approve" ? t.requestDetail.extensionApprove : t.requestDetail.extensionReject}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {extensionApprovalDialog?.action === "approve" && user && ["planning", "sector_head", "admin"].includes(user.role) && (
              <div className="space-y-2">
                <Label>{isRTL ? "تاريخ الانتهاء الجديد (يمكنك التعديل)" : "New Expiry Date (editable)"}</Label>
                <Input
                  type="date"
                  value={extensionEditedDate}
                  min={extensionApprovalDialog.previousExpiryDate}
                  onChange={(e) => setExtensionEditedDate(e.target.value)}
                  data-testid="input-extension-edit-date"
                />
                {extensionApprovalDialog && extensionEditedDate !== extensionApprovalDialog.originalNewExpiryDate && (
                  <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                    {isRTL
                      ? `سيتم تعديل التاريخ المطلوب أصلاً (${extensionApprovalDialog.originalNewExpiryDate}) إلى (${extensionEditedDate}). سيتم تسجيل هذا في السجل ومسار الموافقات.`
                      : `Original requested date (${extensionApprovalDialog.originalNewExpiryDate}) will be changed to (${extensionEditedDate}). Logged in audit trail.`}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>{t.requestDetail.notes}</Label>
              <Textarea
                value={extensionApprovalNotes}
                onChange={(e) => setExtensionApprovalNotes(e.target.value)}
                placeholder={isRTL ? "أضف ملاحظاتك (اختياري — مطلوبة عند تعديل التاريخ)" : "Add your notes (optional — recommended when editing date)"}
                data-testid="input-extension-approval-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtensionApprovalDialog(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant={extensionApprovalDialog?.action === "reject" ? "destructive" : "default"}
              onClick={() => {
                if (extensionApprovalDialog) {
                  const dateChanged = extensionApprovalDialog.action === "approve"
                    && user && ["planning", "sector_head", "admin"].includes(user.role)
                    && extensionEditedDate
                    && extensionEditedDate !== extensionApprovalDialog.originalNewExpiryDate;
                  extensionApprovalMutation.mutate({
                    extensionId: extensionApprovalDialog.extensionId,
                    action: extensionApprovalDialog.action,
                    notes: extensionApprovalNotes,
                    ...(dateChanged ? { newExpiryDate: extensionEditedDate } : {}),
                  });
                }
              }}
              disabled={extensionApprovalMutation.isPending}
              data-testid="button-confirm-extension-approval"
            >
              {extensionApprovalMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {extensionApprovalDialog?.action === "approve" ? t.requestDetail.extensionApprove : t.requestDetail.extensionReject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={endDateDialog} onOpenChange={setEndDateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isRTL ? "تعديل تاريخ الانتهاء" : "Edit End Date"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">{isRTL ? "التاريخ الجديد" : "New Date"}</label>
              <Input
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                data-testid="input-new-end-date"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{isRTL ? "السبب (اختياري)" : "Reason (optional)"}</label>
              <Textarea
                value={endDateReason}
                onChange={(e) => setEndDateReason(e.target.value)}
                placeholder={isRTL ? "سبب التعديل..." : "Reason for change..."}
                rows={2}
                data-testid="input-end-date-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndDateDialog(false)}>{t.common.cancel}</Button>
            <Button
              onClick={() => updateEndDateMutation.mutate({ newEndDate, reason: endDateReason })}
              disabled={!newEndDate || updateEndDateMutation.isPending}
              data-testid="button-confirm-end-date"
            >
              {updateEndDateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isRTL ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isRTL ? "تأكيد حذف الطلب" : "Confirm Delete Request"}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {isRTL 
                ? "هل أنت متأكد من رغبتك في حذف هذا الطلب نهائياً؟ لا يمكن التراجع عن هذا الإجراء وسيتم حذف جميع السجلات المتعلقة به." 
                : "Are you sure you want to delete this request permanently? This action cannot be undone and all related records will be removed."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)}>
              {isRTL ? "تراجع" : t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isRTL ? "حذف نهائي" : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.requestDetail.editTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.requestDetail.departmentLabel}</Label>
                {isPlanningEditor ? (
                  <Select
                    value={editForm.department}
                    onValueChange={(v) => setEditForm(prev => ({ ...prev, department: v }))}
                  >
                    <SelectTrigger data-testid="select-edit-department">
                      <SelectValue placeholder={t.requestCreate.selectDepartment} />
                    </SelectTrigger>
                    <SelectContent>
                      {departmentsQuery.data?.map(d => (
                        <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                      ))}
                      {!departmentsQuery.data?.find(d => d.name === editForm.department) && editForm.department && (
                        <SelectItem value={editForm.department}>{editForm.department}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={editForm.department} readOnly className="bg-muted cursor-not-allowed" data-testid="select-edit-department" />
                )}
              </div>
              <div className="space-y-2">
                <Label>{t.requestDetail.customerAccountNumber}</Label>
                <Input
                  value={editForm.customerAccountNumber}
                  onChange={(e) => setEditForm(prev => ({ ...prev, customerAccountNumber: e.target.value }))}
                  data-testid="input-edit-customer-account-number"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.requestDetail.customerName}</Label>
                <Input
                  value={editForm.customerName}
                  onChange={(e) => setEditForm(prev => ({ ...prev, customerName: e.target.value }))}
                  data-testid="input-edit-customer-name"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.requestDetail.project}</Label>
                <Input
                  value={editForm.projectName}
                  onChange={(e) => setEditForm(prev => ({ ...prev, projectName: e.target.value }))}
                  data-testid="input-edit-project-name"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.requestDetail.durationLabel}</Label>
                <Select
                  value={editForm.reservationDuration}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, reservationDuration: v }))}
                >
                  <SelectTrigger data-testid="select-edit-reservation-duration">
                    <SelectValue placeholder={t.requestCreate.selectDuration} />
                  </SelectTrigger>
                  <SelectContent>
                    {["7", "15", "30", "45", "75", "90"].map(d => (
                      <SelectItem key={d} value={d}>{d} {t.requestDetail.days}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isPlanningEditor && (
                <div className="space-y-2">
                  <Label>{t.requestDetail.requestDateLabel}</Label>
                  <Input
                    type="date"
                    value={editForm.requestDate}
                    onChange={(e) => setEditForm(prev => ({ ...prev, requestDate: e.target.value }))}
                    data-testid="input-edit-request-date"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>{t.requestDetail.endDateLabel}</Label>
                <Input
                  type="date"
                  value={editForm.reservationEndDate}
                  readOnly
                  className="bg-muted cursor-not-allowed"
                  data-testid="input-edit-end-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.requestDetail.advancePaymentLabel} ({t.requestDetail.sar})</Label>
                <Input
                  type="number"
                  value={editForm.advancePayment}
                  onChange={(e) => setEditForm(prev => ({ ...prev, advancePayment: e.target.value }))}
                  data-testid="input-edit-advance-payment"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.requestDetail.sapReservationNumber}</Label>
                {isPlanningEditor ? (
                  <Input
                    value={editForm.sapReservationNumber}
                    onChange={(e) => setEditForm(prev => ({ ...prev, sapReservationNumber: e.target.value }))}
                    data-testid="input-edit-sap-reservation"
                  />
                ) : (
                  <Input value={editForm.sapReservationNumber || "—"} readOnly className="bg-muted cursor-not-allowed" data-testid="input-edit-sap-reservation" />
                )}
              </div>
              {isPlanningEditor && (
                <div className="space-y-2">
                  <Label>{t.requestDetail.salesRepLabel}</Label>
                  <Select
                    value={editForm.salesRepId ? String(editForm.salesRepId) : ""}
                    onValueChange={(v) => setEditForm(prev => ({ ...prev, salesRepId: v ? Number(v) : null }))}
                  >
                    <SelectTrigger data-testid="select-edit-sales-rep">
                      <SelectValue placeholder={t.requestDetail.salesRepLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      {salesReps?.map(rep => (
                        <SelectItem key={rep.id} value={String(rep.id)}>{rep.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t.requestDetail.notesLabel}</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                className="resize-none"
                data-testid="input-edit-notes"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.requestCreate.purchaseOrder}</Label>
                <div className="flex items-center gap-2">
                  <input
                    ref={editPoFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleEditPOUpload}
                    className="hidden"
                    data-testid="input-edit-purchase-order-file"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => editPoFileInputRef.current?.click()}
                    disabled={editUploadingPO}
                    data-testid="button-edit-upload-po"
                  >
                    {editUploadingPO ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    <span>{editPoFileName || t.requestCreate.uploadFile}</span>
                  </Button>
                  {editPoFileName && (
                    <Badge variant="secondary" className="text-xs">
                      {editPoFileName}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t.requestCreate.accountStatement}</Label>
                <div className="flex items-center gap-2">
                  <input
                    ref={editAsFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
                    onChange={handleEditASUpload}
                    className="hidden"
                    data-testid="input-edit-account-statement-file"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => editAsFileInputRef.current?.click()}
                    disabled={editUploadingAS}
                    data-testid="button-edit-upload-as"
                  >
                    {editUploadingAS ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    <span>{editAsFileName || t.requestCreate.uploadFile}</span>
                  </Button>
                  {editAsFileName && (
                    <Badge variant="secondary" className="text-xs">
                      {editAsFileName}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t.requestDetail.productsSection}</Label>
                <Button variant="outline" size="sm" onClick={addEditItem} data-testid="button-add-edit-item">
                  + {t.requestDetail.addItem}
                </Button>
              </div>
              {editForm.items.map((item, index) => (
                <div key={index} className="border rounded-md p-3 space-y-3" data-testid={`edit-item-row-${index}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">{t.requestDetail.item} {index + 1}</span>
                    {editForm.items.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEditItem(index)}
                        data-testid={`button-remove-edit-item-${index}`}
                      >
                        <XCircle className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t.requestCreate.itemCode}</Label>
                      <div className="relative">
                        <Input
                          value={item.itemCode}
                          onChange={(e) => {
                            updateEditItem(index, "itemCode", e.target.value);
                            lookupEditProduct(index, e.target.value);
                          }}
                          className={`${item.lookupStatus === "not_found" ? "border-destructive" : ""} ${item.lookupStatus === "found" ? "border-green-500" : ""}`}
                          data-testid={`input-edit-item-code-${index}`}
                        />
                        {item.lookupStatus === "loading" && (
                          <Loader2 className="absolute top-1/2 -translate-y-1/2 end-2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {item.lookupStatus === "not_found" && item.itemCode.trim() && (
                        <p className="text-xs text-destructive mt-0.5">{t.productsPage.productNotFound}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t.requestDetail.description}</Label>
                      <Input
                        value={item.itemDescription}
                        readOnly
                        className="bg-muted cursor-not-allowed"
                        data-testid={`input-edit-item-desc-${index}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t.requestCreate.brand}</Label>
                      <Input
                        value={item.brand}
                        readOnly
                        className="bg-muted cursor-not-allowed"
                        data-testid={`input-edit-item-brand-${index}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t.requestCreate.quantity}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantityRequested}
                        onChange={(e) => updateEditItem(index, "quantityRequested", Number(e.target.value))}
                        data-testid={`input-edit-item-qty-${index}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t.requestCreate.warehouse}</Label>
                      <Select
                        value={item.warehouse}
                        onValueChange={(v) => updateEditItem(index, "warehouse", v)}
                      >
                        <SelectTrigger data-testid={`select-edit-item-warehouse-${index}`}>
                          <SelectValue placeholder={t.requestCreate.selectWarehouse} />
                        </SelectTrigger>
                        <SelectContent>
                          {warehousesQuery.data?.map(w => (
                            <SelectItem key={w.id} value={w.name}>{w.name}</SelectItem>
                          ))}
                          {!warehousesQuery.data?.find(w => w.name === item.warehouse) && item.warehouse && (
                            <SelectItem value={item.warehouse}>{item.warehouse}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>{t.requestDetail.confirmCancel}</Button>
            <Button
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending}
              data-testid="button-confirm-edit"
            >
              {editMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{t.requestDetail.saveChanges}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
