import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getStatusVariant } from "@/lib/role-utils";
import {
  ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, Search,
  Package, Users, Hash, FileText, TrendingUp, Eye, Building2, Tag, Layers, XCircle,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

interface DimDetailData {
  dimension: string;
  value: string;
  kpis: {
    totalRequests: number;
    totalSalesReps: number;
    totalReservedQty: number;
    totalReleasedQty: number;
    totalRejectedQty: number;
    releaseRate: number;
    uniqueCustomers: number;
    uniqueProjects: number;
  };
  salesReps: {
    name: string;
    requestCount: number;
    reservedQty: number;
    releasedQty: number;
    releaseRate: number;
  }[];
  requests: {
    id: number;
    requestNumber: string;
    projectName: string;
    customerName: string;
    salesRepName: string;
    department: string;
    branchName: string;
    status: string;
    reservedQty: number;
    releasedQty: number;
    reservationEndDate: string | null;
    requestDate: string | null;
  }[];
}

const PAGE_SIZE = 10;

const dimLabels: Record<string, { ar: string; en: string; icon: React.ReactNode }> = {
  customer: { ar: "العميل", en: "Customer", icon: <Users className="w-5 h-5 text-primary" /> },
  branch: { ar: "الفرع", en: "Branch", icon: <Building2 className="w-5 h-5 text-primary" /> },
  brand: { ar: "البراند", en: "Brand", icon: <Tag className="w-5 h-5 text-primary" /> },
  department: { ar: "منفذ البيع", en: "Department", icon: <Layers className="w-5 h-5 text-primary" /> },
  project: { ar: "المشروع", en: "Project", icon: <FileText className="w-5 h-5 text-primary" /> },
};

const statusMap: Record<string, { ar: string; en: string }> = {
  submitted: { ar: "مُقدَّم", en: "Submitted" },
  branch_approved: { ar: "موافقة الفرع", en: "Branch Approved" },
  category_approved: { ar: "موافقة المدير", en: "Category Approved" },
  final_approved: { ar: "معتمد نهائياً", en: "Final Approved" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  expired: { ar: "منتهي", en: "Expired" },
  lost_opportunity: { ar: "فرصة ضائعة", en: "Lost Opportunity" },
  confirmed_lost_opportunity: { ar: "فرصة ضائعة مؤكدة", en: "Confirmed Lost Opportunity" },
  closed: { ar: "مغلق", en: "Closed" },
};

export default function DimReportDetailPage() {
  const [, params] = useRoute("/reports/dim/:dimension/:value");
  const dimension = params?.dimension ?? "";
  const value = decodeURIComponent(params?.value ?? "");

  const { token } = useAuth();
  const { isRTL } = useLang();

  const dimLabel = dimLabels[dimension];
  const pageTitle = isRTL
    ? `تقرير ${dimLabel?.ar ?? dimension}: ${value}`
    : `${dimLabel?.en ?? dimension} Report: ${value}`;
  usePageTitle(pageTitle);

  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const PrevIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;

  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<DimDetailData>({
    queryKey: ["/api/reports/dim-detail", dimension, value],
    queryFn: async () => {
      const res = await fetch(`/api/reports/dim-detail/${encodeURIComponent(dimension)}/${encodeURIComponent(value)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
    enabled: !!token && !!dimension && !!value,
  });

  const filteredRequests = useMemo(() => {
    if (!data?.requests) return [];
    return data.requests.filter(r => {
      const matchSearch = !search || [r.requestNumber, r.projectName, r.customerName, r.salesRepName, r.branchName, r.department].some(v => v?.toLowerCase().includes(search.toLowerCase()));
      const matchRep = repFilter === "all" || r.salesRepName === repFilter;
      return matchSearch && matchRep;
    });
  }, [data, search, repFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const pagedRequests = filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getStatusLabel = (status: string) =>
    isRTL ? (statusMap[status]?.ar ?? status) : (statusMap[status]?.en ?? status);

  return (
    <div className="flex flex-col h-full" dir={isRTL ? "rtl" : "ltr"}>
      <Topbar title={pageTitle} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Link href="/main-reports">
            <Button variant="ghost" size="sm">
              <BackArrow className="w-4 h-4" />
              <span>{isRTL ? "التقارير الرئيسية" : "Main Reports"}</span>
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted/50">{dimLabel?.icon}</div>
          <div>
            <h2 className="text-xl font-bold">{value}</h2>
            <p className="text-sm text-muted-foreground">
              {isRTL
                ? `تفاصيل حجوزات ${dimLabel?.ar ?? dimension}`
                : `Reservation details by ${dimLabel?.en ?? dimension}`}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-md" />)}
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { icon: <Hash className="w-4 h-4 text-primary" />, label: isRTL ? "إجمالي الطلبات" : "Total Requests", value: data.kpis.totalRequests },
                { icon: <Users className="w-4 h-4 text-blue-500" />, label: isRTL ? "المناديب" : "Sales Reps", value: data.kpis.totalSalesReps },
                { icon: <Package className="w-4 h-4 text-amber-500" />, label: isRTL ? "الكمية المحجوزة" : "Reserved Qty", value: data.kpis.totalReservedQty.toLocaleString() },
                { icon: <TrendingUp className="w-4 h-4 text-emerald-500" />, label: isRTL ? "الكمية المُصدَّرة" : "Released Qty", value: data.kpis.totalReleasedQty.toLocaleString() },
                ...(data.kpis.totalRejectedQty > 0 ? [{ icon: <XCircle className="w-4 h-4 text-red-500" />, label: isRTL ? "الكمية المرفوضة" : "Rejected Qty", value: data.kpis.totalRejectedQty.toLocaleString() }] : []),
                { icon: <TrendingUp className="w-4 h-4 text-emerald-600" />, label: isRTL ? "نسبة الإصدار" : "Release Rate", value: `${data.kpis.releaseRate}%` },
                { icon: <FileText className="w-4 h-4 text-violet-500" />, label: isRTL ? "العملاء" : "Customers", value: data.kpis.uniqueCustomers },
                { icon: <FileText className="w-4 h-4 text-orange-500" />, label: isRTL ? "المشاريع" : "Projects", value: data.kpis.uniqueProjects },
              ].map((kpi, i) => (
                <Card key={i}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="p-2 rounded-md bg-muted/50">{kpi.icon}</div>
                    <div>
                      <p className="text-xs text-muted-foreground">{kpi.label}</p>
                      <p className="text-lg font-bold tabular-nums">{kpi.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-2">
                <h3 className="text-sm font-semibold">
                  {isRTL ? "المناديب" : "Sales Reps"}
                </h3>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "المندوب" : "Sales Rep"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "عدد الطلبات" : "Requests"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "الكمية المحجوزة" : "Reserved Qty"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "الكمية المُصدَّرة" : "Released Qty"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "نسبة الإصدار" : "Release Rate"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.salesReps.length === 0 ? (
                        <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{isRTL ? "لا توجد بيانات" : "No data"}</td></tr>
                      ) : data.salesReps.map((rep) => (
                        <tr
                          key={rep.name}
                          className={`border-b last:border-0 hover:bg-muted/30 cursor-pointer ${rep.name === repFilter ? "bg-primary/5 dark:bg-primary/10" : ""}`}
                          onClick={() => { setRepFilter(rep.name === repFilter ? "all" : rep.name); setPage(1); }}
                        >
                          <td className="p-3 font-medium flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-muted-foreground" />
                            {rep.name}
                            {rep.name === repFilter && <Badge variant="secondary" className="text-xs">{isRTL ? "مفلتر" : "Filtered"}</Badge>}
                          </td>
                          <td className="p-3 tabular-nums">{rep.requestCount}</td>
                          <td className="p-3 tabular-nums">{rep.reservedQty.toLocaleString()}</td>
                          <td className="p-3 tabular-nums text-emerald-600 dark:text-emerald-400">{rep.releasedQty.toLocaleString()}</td>
                          <td className="p-3">
                            <Badge variant={rep.releaseRate > 70 ? "default" : rep.releaseRate > 40 ? "secondary" : "destructive"}>
                              {rep.releaseRate}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-semibold">
                    {isRTL ? `الطلبات (${filteredRequests.length})` : `Requests (${filteredRequests.length})`}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground ${isRTL ? "right-2.5" : "left-2.5"}`} />
                      <Input
                        placeholder={isRTL ? "بحث..." : "Search..."}
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                        className={`w-52 h-8 text-xs ${isRTL ? "pr-8" : "pl-8"}`}
                        data-testid="input-dim-search"
                      />
                    </div>
                    {repFilter !== "all" && (
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setRepFilter("all")}>
                        {isRTL ? `المندوب: ${repFilter} ✕` : `Rep: ${repFilter} ✕`}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "رقم الطلب" : "Request #"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "تاريخ الطلب" : "Date"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "المشروع" : "Project"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "العميل" : "Customer"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "المندوب" : "Sales Rep"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "منفذ البيع" : "Channel"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "الفرع" : "Branch"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "الكمية" : "Qty"}</th>
                        <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{isRTL ? "الحالة" : "Status"}</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRequests.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-8 text-center text-muted-foreground">
                            {isRTL ? "لا توجد طلبات" : "No requests found"}
                          </td>
                        </tr>
                      ) : pagedRequests.map(req => (
                        <tr key={req.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-request-${req.id}`}>
                          <td className="p-3">
                            <span className="font-mono text-xs font-medium">#{req.requestNumber}</span>
                          </td>
                          <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{req.requestDate || "-"}</td>
                          <td className="p-3 max-w-[130px] truncate">{req.projectName}</td>
                          <td className="p-3 max-w-[130px] truncate">{req.customerName || "-"}</td>
                          <td className="p-3 font-medium">{req.salesRepName}</td>
                          <td className="p-3 text-muted-foreground text-xs">{req.department || "-"}</td>
                          <td className="p-3 text-muted-foreground text-xs">{req.branchName}</td>
                          <td className="p-3 tabular-nums">
                            <span className="text-amber-600 dark:text-amber-400">{req.reservedQty.toLocaleString()}</span>
                            {req.releasedQty > 0 && (
                              <span className="text-emerald-600 dark:text-emerald-400 text-xs ms-1">({req.releasedQty.toLocaleString()}✓)</span>
                            )}
                          </td>
                          <td className="p-3">
                            <Badge variant={getStatusVariant(req.status as any)} className="text-xs">
                              {getStatusLabel(req.status)}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Link href={`/requests/${req.id}`}>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`button-view-request-${req.id}`}>
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-2 p-3 border-t">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {isRTL
                      ? `صفحة ${page} من ${totalPages} (${filteredRequests.length})`
                      : `Page ${page} of ${totalPages} (${filteredRequests.length})`}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">
                      <PrevIcon className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
                      <NextIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
