import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { getStatusLabels, getDisplayStatus, getStatusVariant } from "@/lib/role-utils";
import { useLang } from "@/lib/i18n";
import { Link, useSearch } from "wouter";
import { Search, FilePlus, Package, FileText, User as UserIcon, Calendar, Clock, AlertTriangle, Download, Loader2, CheckSquare, Bell, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Request, RequestItem, User } from "@shared/schema";

const APPROVER_ROLES = ["branch_manager", "category_manager", "planning", "sector_head"];

function getMyActionStatus(role: string): string | null {
  if (role === "branch_manager") return "submitted";
  if (role === "category_manager") return "branch_approved";
  if (role === "planning") return "category_approved";
  return null;
}

type RequestWithRelations = Request & { items: RequestItem[]; creator: User };

function getExpiryInfo(req: RequestWithRelations) {
  if (req.status !== "final_approved" || !req.reservationEndDate) return null;
  const hasUnreleased = req.items?.some(i => i.quantityRequested - i.quantityReleased > 0);
  if (!hasUnreleased) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(req.reservationEndDate);
  endDate.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0 && diffDays >= -7) return { expired: true, days: 0 };
  if (diffDays > 0 && diffDays <= 3) return { expired: false, days: diffDays };
  return null;
}

export default function RequestsListPage() {
  usePageTitle("جميع الطلبات");
  const { token, user } = useAuth();
  const { t, isRTL } = useLang();
  const { toast } = useToast();
  const statusLabels = getStatusLabels(t);
  const searchString = useSearch();
  const initialStatus = new URLSearchParams(searchString.replace(/^\?/, "")).get("status") || "all";
  const isApprover = user ? APPROVER_ROLES.includes(user.role) : false;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [myActionOnly, setMyActionOnly] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;
  const [salesRepFilter, setSalesRepFilter] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(new Set());
  const [exportSearch, setExportSearch] = useState("");
  const [exportType, setExportType] = useState<"detailed" | "simple">("detailed");
  const [exportStatusFilter, setExportStatusFilter] = useState<Set<string>>(new Set());
  const canExport = ["planning", "admin", "sector_head", "category_manager", "sales_rep", "branch_manager"].includes(user?.role || "");

  const { data: requests, isLoading } = useQuery<RequestWithRelations[]>({
    queryKey: ["/api/requests"],
    queryFn: async () => {
      const res = await fetch("/api/requests", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: pendingExtData } = useQuery<{ requestIds: number[] }>({
    queryKey: ["/api/extensions/pending-my-action"],
    queryFn: async () => {
      const res = await fetch("/api/extensions/pending-my-action", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { requestIds: [] };
      return res.json();
    },
    enabled: !!token && isApprover,
  });

  const pendingExtensionRequestIds = useMemo(
    () => new Set(pendingExtData?.requestIds ?? []),
    [pendingExtData]
  );

  const myActionStatus = user ? getMyActionStatus(user.role) : null;

  const myActionCount = useMemo(() => {
    if (!requests || !user || !isApprover) return 0;
    const ids = new Set<number>();
    for (const r of requests) {
      if (pendingExtensionRequestIds.has(r.id)) { ids.add(r.id); continue; }
      if (user.role === "sector_head") {
        if ((r as any).salesChannel === "strategic_reservation" && r.status === "category_approved") ids.add(r.id);
        continue;
      }
      if (!myActionStatus) continue;
      if (user.role === "planning" && (r as any).salesChannel === "strategic_reservation") continue;
      if (r.status === myActionStatus) ids.add(r.id);
    }
    return ids.size;
  }, [requests, user, isApprover, myActionStatus, pendingExtensionRequestIds]);

  const exportFilteredRequests = useMemo(() => {
    if (!requests) return [];
    let filtered = requests;
    if (exportStatusFilter.size > 0) {
      filtered = filtered.filter(r => exportStatusFilter.has(r.status));
    }
    if (exportSearch) {
      const q = exportSearch.toLowerCase();
      filtered = filtered.filter(r =>
        r.requestNumber.toLowerCase().includes(q) ||
        r.creator?.name?.toLowerCase().includes(q) ||
        r.customerName?.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [requests, exportSearch, exportStatusFilter]);

  function openExportDialog() {
    setSelectedRequestIds(new Set());
    setExportSearch("");
    setExportStatusFilter(new Set());
    setExportDialogOpen(true);
  }

  function toggleRequest(id: number) {
    setSelectedRequestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedRequestIds(new Set(exportFilteredRequests.map(r => r.id)));
  }

  function deselectAll() {
    setSelectedRequestIds(new Set());
  }

  const allSelected = exportFilteredRequests.length > 0 && exportFilteredRequests.every(r => selectedRequestIds.has(r.id));

  async function handleExportExcel(format: "simple" | "detailed") {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (selectedRequestIds.size > 0 && selectedRequestIds.size < (requests?.length || 0)) {
        params.set("requestIds", Array.from(selectedRequestIds).join(","));
      }
      params.set("format", format);
      const qs = params.toString();
      const response = await fetch(`/api/requests/export/excel${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fileLabel = format === "simple" ? "مبسط" : "تفصيلي";
      a.download = `Requests_${fileLabel}_${new Date().toISOString().split("T")[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setExportDialogOpen(false);
    } catch (err) {
      toast({ title: isRTL ? "فشل التصدير" : "Export failed", variant: "destructive" });
    }
    setExporting(false);
  }

  const uniqueSalesReps = useMemo(() => {
    if (!requests) return [];
    const seen = new Set<string>();
    const reps: { id: string; name: string }[] = [];
    for (const r of requests) {
      const name = r.creator?.name;
      if (name && !seen.has(name)) {
        seen.add(name);
        reps.push({ id: name, name });
      }
    }
    return reps.sort((a, b) => a.name.localeCompare(b.name));
  }, [requests]);

  const filtered = useMemo(() => {
    setPage(1);
    if (!requests) return [];
    const q = search.toLowerCase();
    return requests.filter((r) => {
      const matchSearch = !search ||
        r.requestNumber.toLowerCase().includes(q) ||
        r.projectName?.toLowerCase().includes(q) ||
        r.creator?.name?.toLowerCase().includes(q);
      const matchStatus = statusFilter === "all"
        || (statusFilter === "pending" && ["submitted", "branch_approved", "category_approved"].includes(r.status))
        || r.status === statusFilter;
      const matchSalesRep = salesRepFilter === "all" || r.creator?.name === salesRepFilter;
      const matchMyAction = !myActionOnly || pendingExtensionRequestIds.has(r.id) || (
        user?.role === "sector_head"
          ? (r as any).salesChannel === "strategic_reservation" && r.status === "category_approved"
          : user?.role === "planning" && (r as any).salesChannel === "strategic_reservation" && r.status === "category_approved"
            ? false
            : r.status === myActionStatus
      );
      return matchSearch && matchStatus && matchSalesRep && matchMyAction;
    });
  }, [requests, search, statusFilter, salesRepFilter, myActionOnly, myActionStatus, pendingExtensionRequestIds, user?.role]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedFiltered = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.requests.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">

        {isApprover && (
          <button
            onClick={() => setMyActionOnly(v => !v)}
            data-testid="button-my-action-filter"
            className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border-2 transition-all ${
              myActionOnly
                ? "border-primary bg-primary/10 dark:bg-primary/20"
                : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/60"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-md ${myActionOnly ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                <Bell className="w-4 h-4" />
              </div>
              <div className={`text-start ${isRTL ? "text-right" : "text-left"}`}>
                <p className={`text-sm font-semibold ${myActionOnly ? "text-primary" : "text-foreground"}`}>
                  {isRTL ? "بانتظار موافقتي" : "Pending My Approval"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isRTL ? "الطلبات التي تحتاج إجراءاً منك" : "Requests that require your action"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {myActionCount > 0 ? (
                <span className={`text-lg font-bold tabular-nums px-3 py-1 rounded-full ${
                  myActionOnly ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"
                }`}>
                  {myActionCount}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground px-3 py-1 rounded-full bg-muted">
                  {isRTL ? "لا يوجد" : "None"}
                </span>
              )}
              {myActionOnly && (
                <Badge variant="secondary" className="text-xs">
                  {isRTL ? "مفعّل" : "Active"}
                </Badge>
              )}
            </div>
          </button>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className={`absolute ${isRTL ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground`} />
              <Input
                placeholder={isRTL ? "رقم الطلب، اسم المشروع، المندوب..." : "Request #, project, sales rep..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={isRTL ? "pr-9" : "pl-9"}
                data-testid="input-search-requests"
              />
            </div>
            <Select value={salesRepFilter} onValueChange={setSalesRepFilter}>
              <SelectTrigger className="w-[175px]" data-testid="select-salesrep-filter">
                <UserIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder={isRTL ? "مندوب المبيعات" : "Sales Rep"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isRTL ? "جميع المندوبين" : "All Sales Reps"}</SelectItem>
                {uniqueSalesReps.map((rep) => (
                  <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <SelectValue placeholder={t.requests.filterByStatus} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.requests.allStatuses}</SelectItem>
                {Object.entries(statusLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canExport && (
              <Button
                variant="outline"
                onClick={openExportDialog}
                data-testid="button-export-excel"
              >
                <Download className="w-4 h-4" />
                <span>{isRTL ? "تصدير اكسل" : "Export Excel"}</span>
              </Button>
            )}
            <Link href="/requests/new">
              <Button data-testid="button-new-request">
                <FilePlus className="w-4 h-4" />
                <span>{t.nav.newRequest}</span>
              </Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-4 w-60" />
                    </div>
                    <Skeleton className="h-6 w-24" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-base font-medium text-muted-foreground">{t.requests.noRequests}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {myActionOnly
                  ? (isRTL ? "لا توجد طلبات بانتظار موافقتك حالياً" : "No requests waiting for your approval right now")
                  : search || statusFilter !== "all" || salesRepFilter !== "all" ? t.requests.adjustSearch : t.requests.createFirst}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pagedFiltered.map((req) => {
              const expiryInfo = getExpiryInfo(req);
              const isStrategicReservation = (req as any).salesChannel === "strategic_reservation";
              const needsMyAction = isApprover && (pendingExtensionRequestIds.has(req.id) || (
                user?.role === "sector_head"
                  ? isStrategicReservation && req.status === "category_approved"
                  : user?.role === "planning" && isStrategicReservation && req.status === "category_approved"
                    ? false
                    : req.status === myActionStatus
              ));
              return (
                <Link key={req.id} href={`/requests/${req.id}`}>
                  <Card className={`hover-elevate cursor-pointer ${
                    expiryInfo ? "border-destructive/60" :
                    needsMyAction ? "border-primary/50 bg-primary/5 dark:bg-primary/10" : ""
                  }`} data-testid={`card-request-${req.id}`}>
                    <CardContent className="p-4 md:p-5">
                      <div className="flex items-center justify-between gap-6 flex-wrap md:flex-nowrap">
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            expiryInfo ? "bg-destructive/10" :
                            needsMyAction ? "bg-primary/20" : "bg-primary/10"
                          }`}>
                            {expiryInfo ? (
                              <AlertTriangle className="w-5 h-5 text-destructive" />
                            ) : needsMyAction ? (
                              <Bell className="w-5 h-5 text-primary" />
                            ) : (
                              <FileText className="w-5 h-5 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-base">#{req.requestNumber}</span>
                              <span className="text-sm font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-border/50">
                                {req.projectName}
                              </span>
                              <Badge variant={getStatusVariant(req.status as any)} className="px-2 py-0 h-5 text-[10px] uppercase tracking-wider font-bold">
                                {getDisplayStatus(req.status, (req as any).salesChannel, isRTL, t)}
                              </Badge>
                              {expiryInfo && (
                                <Badge variant="destructive" className="px-2 py-0 h-5 text-[10px] font-bold animate-pulse" data-testid={`badge-expiring-${req.id}`}>
                                  <AlertTriangle className="w-3 h-3 mr-1 rtl:ml-1 rtl:mr-0" />
                                  {expiryInfo.expired
                                    ? t.expiring.expiredBadge
                                    : `${expiryInfo.days} ${expiryInfo.days === 1 ? t.expiring.dayRemaining : t.expiring.daysRemaining}`
                                  }
                                </Badge>
                              )}
                              {needsMyAction && !expiryInfo && (
                                <Badge className="px-2 py-0 h-5 text-[10px] font-bold gap-1 bg-primary/20 text-primary dark:bg-primary/30 border-primary/30 hover:bg-primary/20" data-testid={`badge-my-action-${req.id}`}>
                                  <Bell className="w-2.5 h-2.5" />
                                  {isRTL ? "بانتظار موافقتك" : "Needs Your Approval"}
                                </Badge>
                              )}
                              {(() => {
                                const st = req.status;
                                const isSR = (req as any).salesChannel === "strategic_reservation";
                                let nl: string | null = null;
                                if (st === "submitted") nl = isRTL ? "⟳ مدير الفرع" : "⟳ Branch Manager";
                                else if (st === "branch_approved") nl = isRTL ? "⟳ مدير الصنف" : "⟳ Category Manager";
                                else if (st === "category_approved") {
                                  if (isSR) nl = isRTL ? "⟳ مدير القطاع" : "⟳ Sector Head";
                                  else nl = isRTL ? "⟳ التخطيط" : "⟳ Planning";
                                }
                                return nl ? (
                                  <Badge variant="outline" className="px-1.5 py-0 h-5 text-[10px] border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20" data-testid={`badge-next-approver-${req.id}`}>
                                    {nl}
                                  </Badge>
                                ) : null;
                              })()}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Package className="w-3 h-3" />
                                {req.items?.length ?? 0} {t.dashboard.products}
                              </span>
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                              <span className="flex items-center gap-1">
                                <UserIcon className="w-3 h-3" />
                                {req.creator?.name ?? t.dashboard.unknown}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground border-r pr-4 rtl:border-r-0 rtl:border-l rtl:pl-4 border-border/50">
                          <div className="flex items-center gap-1.5 font-medium text-foreground/80">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{(() => { const d = new Date(req.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })()}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{(() => { const d = new Date(req.createdAt); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; })()}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

        {!isLoading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 py-2 border-t" dir={isRTL ? "rtl" : "ltr"}>
            <span className="text-xs text-muted-foreground tabular-nums">
              {isRTL
                ? `عرض ${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} من ${filtered.length}`
                : `Showing ${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                data-testid="button-prev-page"
              >
                {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce<(number | "...")[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground text-sm">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={page === p ? "default" : "outline"}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => setPage(p as number)}
                      data-testid={`button-page-${p}`}
                    >
                      {p}
                    </Button>
                  )
                )}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                data-testid="button-next-page"
              >
                {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{isRTL ? "تصدير الطلبات إلى اكسل" : "Export Requests to Excel"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="relative">
              <Search className={`absolute ${isRTL ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground`} />
              <Input
                placeholder={isRTL ? "ابحث عن طلب..." : "Search requests..."}
                value={exportSearch}
                onChange={(e) => setExportSearch(e.target.value)}
                className={isRTL ? "pr-9" : "pl-9"}
                data-testid="input-export-search"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["submitted", "branch_approved", "category_approved", "final_approved", "rejected", "expired"] as const).map((st) => {
                const isActive = exportStatusFilter.has(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setExportStatusFilter(prev => {
                        const next = new Set(prev);
                        if (next.has(st)) next.delete(st); else next.add(st);
                        return next;
                      });
                      setSelectedRequestIds(new Set());
                    }}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                    }`}
                    data-testid={`export-status-filter-${st}`}
                  >
                    {statusLabels[st as keyof typeof statusLabels]}
                  </button>
                );
              })}
              {exportStatusFilter.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setExportStatusFilter(new Set()); setSelectedRequestIds(new Set()); }}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors"
                  data-testid="export-status-filter-clear"
                >
                  {isRTL ? "مسح الفلتر" : "Clear"}
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {isRTL
                  ? `تم اختيار ${selectedRequestIds.size} من ${exportFilteredRequests.length}`
                  : `${selectedRequestIds.size} of ${exportFilteredRequests.length} selected`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={allSelected ? deselectAll : selectAll}
                data-testid="button-select-all"
              >
                <CheckSquare className="w-4 h-4" />
                <span>{allSelected ? (isRTL ? "إلغاء الكل" : "Deselect All") : (isRTL ? "تحديد الكل" : "Select All")}</span>
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto border rounded-md divide-y max-h-[350px]">
              {exportFilteredRequests.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  data-testid={`export-row-${r.id}`}
                >
                  <Checkbox
                    checked={selectedRequestIds.has(r.id)}
                    onCheckedChange={() => toggleRequest(r.id)}
                    data-testid={`checkbox-export-${r.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">#{r.requestNumber}</span>
                      <Badge variant={getStatusVariant(r.status as any)} className="px-1.5 py-0 h-4 text-[9px]">
                        {getDisplayStatus(r.status, (r as any).salesChannel, isRTL, t)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.creator?.name || ""} {r.customerName ? `• ${r.customerName}` : ""}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {r.requestDate}
                  </span>
                </label>
              ))}
              {exportFilteredRequests.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {isRTL ? "لا توجد نتائج" : "No results found"}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 justify-between pt-3 border-t">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setExportDialogOpen(false)} data-testid="button-cancel-export">
                {isRTL ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                variant="outline"
                onClick={() => { selectAll(); }}
                data-testid="button-export-all"
              >
                <CheckSquare className="w-4 h-4" />
                <span>{isRTL ? "الكل" : "All"}</span>
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => handleExportExcel("simple")}
                disabled={exporting || selectedRequestIds.size === 0}
                data-testid="button-export-simple"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{isRTL ? "تصدير مبسط" : "Simple Export"}</span>
              </Button>
              <Button
                onClick={() => handleExportExcel("detailed")}
                disabled={exporting || selectedRequestIds.size === 0}
                data-testid="button-export-detailed"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{isRTL ? "تصدير تفصيلي" : "Detailed Export"}</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
