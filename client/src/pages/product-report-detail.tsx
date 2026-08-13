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
  Package, Users, Hash, FileText, TrendingUp, Eye, Tag, Grid3X3, XCircle,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

interface ProductDetailData {
  itemCode: string;
  description: string;
  brand: string | null;
  category: string | null;
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

export default function ProductReportDetailPage() {
  const [, params] = useRoute("/reports/product/:code");
  const itemCode = decodeURIComponent(params?.code ?? "");
  usePageTitle(`تقرير الصنف: ${itemCode}`);

  const { token } = useAuth();
  const { isRTL } = useLang();

  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("all");
  const [page, setPage] = useState(1);

  const BackArrow = isRTL ? ArrowRight : ArrowLeft;
  const PrevIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;

  const { data, isLoading } = useQuery<ProductDetailData>({
    queryKey: ["/api/reports/product-detail", itemCode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/product-detail/${encodeURIComponent(itemCode)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load product report");
      return res.json();
    },
    enabled: !!token && !!itemCode,
  });

  const filteredRequests = useMemo(() => {
    if (!data?.requests) return [];
    return data.requests.filter(r => {
      const matchSearch = !search || [r.requestNumber, r.projectName, r.customerName, r.salesRepName, r.branchName].some(v => v?.toLowerCase().includes(search.toLowerCase()));
      const matchRep = repFilter === "all" || r.salesRepName === repFilter;
      return matchSearch && matchRep;
    });
  }, [data, search, repFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const pagedRequests = filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getStatusLabel = (status: string) => {
    const map: Record<string, { ar: string; en: string }> = {
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
    return isRTL ? (map[status]?.ar ?? status) : (map[status]?.en ?? status);
  };

  return (
    <div className="flex flex-col h-full" dir={isRTL ? "rtl" : "ltr"}>
      <Topbar title={isRTL ? `تقرير الصنف: ${itemCode}` : `Product Report: ${itemCode}`} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Link href="/main-reports">
            <Button variant="ghost" size="sm">
              <BackArrow className="w-4 h-4" />
              <span>{isRTL ? "التقارير الرئيسية" : "Main Reports"}</span>
            </Button>
          </Link>
        </div>

        <div>
          <h2 className="text-xl font-bold">{itemCode}</h2>
          {data?.description && data.description !== itemCode && (
            <p className="text-sm text-muted-foreground mt-0.5">{data.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {data?.brand && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Tag className="w-3 h-3" />
                {data.brand}
              </Badge>
            )}
            {data?.category && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Grid3X3 className="w-3 h-3" />
                {data.category}
              </Badge>
            )}
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
                <h3 className="text-sm font-semibold">{isRTL ? "المناديب الحاجزين لهذا الصنف" : "Sales Reps Who Reserved This Product"}</h3>
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
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground">{isRTL ? "لا توجد بيانات" : "No data"}</td>
                        </tr>
                      ) : data.salesReps.map((rep) => (
                        <tr key={rep.name} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => { setRepFilter(rep.name === repFilter ? "all" : rep.name); setPage(1); }}>
                          <td className="p-3 font-medium">
                            <div className="flex items-center gap-2">
                              <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              {rep.name}
                              {rep.name === repFilter && <Badge variant="secondary" className="text-xs">{isRTL ? "مفلتر" : "Filtered"}</Badge>}
                            </div>
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
                  <h3 className="text-sm font-semibold">{isRTL ? `الطلبات (${filteredRequests.length})` : `Requests (${filteredRequests.length})`}</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground ${isRTL ? "right-2.5" : "left-2.5"}`} />
                      <Input
                        placeholder={isRTL ? "بحث..." : "Search..."}
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                        className={`w-52 h-8 text-xs ${isRTL ? "pr-8" : "pl-8"}`}
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
                          <td colSpan={10} className="p-8 text-center text-muted-foreground">{isRTL ? "لا توجد طلبات" : "No requests found"}</td>
                        </tr>
                      ) : pagedRequests.map(req => (
                        <tr key={req.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3">
                            <span className="font-mono text-xs font-medium">#{req.requestNumber}</span>
                          </td>
                          <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{req.requestDate || "-"}</td>
                          <td className="p-3 max-w-[150px] truncate">{req.projectName}</td>
                          <td className="p-3 max-w-[150px] truncate">{req.customerName || "-"}</td>
                          <td className="p-3 font-medium">{req.salesRepName}</td>
                          <td className="p-3 text-muted-foreground">{req.department || "-"}</td>
                          <td className="p-3 text-muted-foreground">{req.branchName}</td>
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
                    {isRTL ? `صفحة ${page} من ${totalPages} (${filteredRequests.length})` : `Page ${page} of ${totalPages} (${filteredRequests.length})`}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                      <PrevIcon className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
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
