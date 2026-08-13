import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Topbar } from "@/components/topbar";
import {
  BarChart3, Users, FolderKanban, Package, Building2,
  Tag, Layers, Grid3X3, Clock, AlertTriangle,
  TrendingUp, DollarSign, Hash, Snowflake, Download, X, Search,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";
import { ReportByDimension } from "@/components/report-by-dimension";

interface SummaryData {
  kpis: {
    totalRequests: number;
    totalCustomers: number;
    totalProjects: number;
    totalReservedQty: number;
    totalReleasedQty: number;
    totalRejectedQty: number;
    frozenQty: number;
    conversionRate: number;
    avgApprovalTime: number;
    totalReservedValue: number;
    totalReleasedValue: number;
    frozenValue: number;
    totalReservedCost: number;
    totalReleasedCost: number;
    frozenCost: number;
    totalReservedProfit: number;
    totalReleasedProfit: number;
    frozenProfit: number;
    expiringIn72h: number;
    expiredUnreleased: number;
  };
  statusChart: { status: string; count: number }[];
  trendChart: { month: string; reserved: number; released: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "#3b82f6",
  branch_approved: "#8b5cf6",
  category_approved: "#f59e0b",
  final_approved: "#10b981",
  rejected: "#ef4444",
  expired: "#6b7280",
  lost_opportunity: "#9ca3af",
  confirmed_lost_opportunity: "#6b7280",
  closed: "#10b981",
};

export default function MainReportsPage() {
  const { user, token } = useAuth();
  const { t, isRTL } = useLang();
  const mr = t.mainReports;
  const showCost = user?.role !== "branch_manager" && user?.role !== "sales_rep";

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [activeTab, setActiveTab] = useState("summary");
  const [exporting, setExporting] = useState(false);

  type StatusOption = "ALL" | "FINAL_APPROVED" | "FULLY_RELEASED" | "PARTIALLY_RELEASED" | "EXPIRED";
  const statusOptions: { value: StatusOption; labelKey: keyof typeof mr }[] = [
    { value: "ALL", labelKey: "statusAll" },
    { value: "FINAL_APPROVED", labelKey: "statusFinalApproved" },
    { value: "FULLY_RELEASED", labelKey: "statusFullyReleased" },
    { value: "PARTIALLY_RELEASED", labelKey: "statusPartiallyReleased" },
    { value: "EXPIRED", labelKey: "statusExpired" },
  ];

  const getStatusLabel = (val: string) => {
    const opt = statusOptions.find(o => o.value === val);
    return opt ? mr[opt.labelKey] : val;
  };

  const statusColorMap: Record<string, string> = {
    FULLY_RELEASED: "text-emerald-600 dark:text-emerald-400",
    PARTIALLY_RELEASED: "text-amber-600 dark:text-amber-400",
    EXPIRED: "text-red-600 dark:text-red-400",
  };

  if (!user || (user.role !== "planning" && user.role !== "admin" && user.role !== "sector_head" && user.role !== "category_manager" && user.role !== "branch_manager" && user.role !== "sales_rep")) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={mr.title} />
        <div className="flex items-center justify-center flex-1 p-8">
          <Card className="max-w-md w-full">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-destructive" />
              <p className="text-lg font-semibold">{mr.accessDenied}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const qp = new URLSearchParams();
  if (dateFrom) qp.set("dateFrom", dateFrom);
  if (dateTo) qp.set("dateTo", dateTo);
  if (statusFilter !== "ALL") qp.set("status", statusFilter);
  const qs = qp.toString();

  const { data: summaryData, isLoading: summaryLoading } = useQuery<SummaryData>({
    queryKey: ["/api/main-reports/summary", qs],
    queryFn: async () => {
      const res = await fetch(`/api/main-reports/summary${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
    enabled: !!token && activeTab === "summary",
  });

  const kpis = summaryData?.kpis;

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatusFilter("ALL");
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const qpExport = new URLSearchParams();
      if (dateFrom) qpExport.set("dateFrom", dateFrom);
      if (dateTo) qpExport.set("dateTo", dateTo);
      if (statusFilter !== "ALL") qpExport.set("status", statusFilter);
      const exportQs = qpExport.toString();
      const res = await fetch(`/api/main-reports/export${exportQs ? `?${exportQs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Main_Reports_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Topbar title={mr.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4" dir={isRTL ? "rtl" : "ltr"}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[140px]"
              data-testid="input-main-reports-date-from"
            />
            <span className="text-xs text-muted-foreground">-</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[140px]"
              data-testid="input-main-reports-date-to"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-main-reports-status">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <SelectValue placeholder={mr.statusFilter} />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`select-status-${opt.value}`}>
                    {mr[opt.labelKey]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(dateFrom || dateTo || statusFilter !== "ALL") && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-main-reports-clear">
                {mr.reset}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} data-testid="button-main-reports-export">
              <Download className="w-4 h-4" />
              {mr.exportExcel}
            </Button>
          </div>
        </div>

        {statusFilter !== "ALL" && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1.5">
              <Search className="w-3 h-3" />
              <span>{mr.activeStatus}: </span>
              <span className={statusColorMap[statusFilter] || ""}>{getStatusLabel(statusFilter)}</span>
              <button
                onClick={() => setStatusFilter("ALL")}
                className="rounded-full p-0.5 hover-elevate"
                data-testid="button-clear-status-badge"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          </div>
        )}

      <Tabs value={activeTab} onValueChange={setActiveTab} dir={isRTL ? "rtl" : "ltr"}>
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto min-w-full" data-testid="tabs-main-reports">
            <TabsTrigger value="summary" data-testid="tab-summary">
              <BarChart3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabSummary}</span>
            </TabsTrigger>
            <TabsTrigger value="customer" data-testid="tab-customer">
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabCustomer}</span>
            </TabsTrigger>
            <TabsTrigger value="project" data-testid="tab-project">
              <FolderKanban className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabProject}</span>
            </TabsTrigger>
            <TabsTrigger value="product" data-testid="tab-product">
              <Package className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabProduct}</span>
            </TabsTrigger>
            <TabsTrigger value="branch" data-testid="tab-branch">
              <Building2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabBranch}</span>
            </TabsTrigger>
            <TabsTrigger value="brand" data-testid="tab-brand">
              <Tag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabBrand}</span>
            </TabsTrigger>
            <TabsTrigger value="department" data-testid="tab-department">
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabDepartment}</span>
            </TabsTrigger>
            <TabsTrigger value="category" data-testid="tab-category">
              <Grid3X3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{mr.tabCategory}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary" className="mt-4 space-y-4">
          {summaryLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-md" />
              ))}
            </div>
          ) : kpis ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-summary-kpis">
                <KpiCard icon={<Hash className="w-4 h-4" />} label={mr.totalRequests} value={kpis.totalRequests.toLocaleString()} />
                <KpiCard icon={<Users className="w-4 h-4" />} label={mr.totalCustomers} value={kpis.totalCustomers.toLocaleString()} />
                <KpiCard icon={<FolderKanban className="w-4 h-4" />} label={mr.totalProjects} value={kpis.totalProjects.toLocaleString()} />
                <KpiCard icon={<Clock className="w-4 h-4" />} label={mr.avgApprovalTime} value={`${kpis.avgApprovalTime} ${mr.hours}`} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-summary-quantities">
                <KpiCard icon={<Package className="w-4 h-4" />} label={mr.totalReservedQty} value={kpis.totalReservedQty.toLocaleString()} />
                <KpiCard icon={<TrendingUp className="w-4 h-4 text-emerald-500" />} label={mr.totalReleasedQty} value={kpis.totalReleasedQty.toLocaleString()} color="emerald" />
                <KpiCard icon={<Snowflake className="w-4 h-4 text-blue-500" />} label={mr.frozenQty} value={kpis.frozenQty.toLocaleString()} color="blue" />
                <KpiCard icon={<X className="w-4 h-4 text-red-500" />} label={isRTL ? "الكمية المرفوضة" : "Rejected Qty"} value={(kpis.totalRejectedQty ?? 0).toLocaleString()} color="red" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-summary-financial">
                <KpiCard icon={<DollarSign className="w-4 h-4" />} label={mr.totalReservedValue} value={`${kpis.totalReservedValue.toLocaleString()} ${mr.sar}`} />
                <KpiCard icon={<DollarSign className="w-4 h-4 text-emerald-500" />} label={mr.totalReleasedValue} value={`${kpis.totalReleasedValue.toLocaleString()} ${mr.sar}`} color="emerald" />
                <KpiCard icon={<Snowflake className="w-4 h-4 text-blue-500" />} label={mr.frozenValue} value={`${kpis.frozenValue.toLocaleString()} ${mr.sar}`} color="blue" />
              </div>

              {showCost && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-summary-cost">
                  <KpiCard icon={<DollarSign className="w-4 h-4 text-orange-500" />} label={mr.totalReservedCost} value={`${(kpis.totalReservedCost ?? 0).toLocaleString()} ${mr.sar}`} color="orange" />
                  <KpiCard icon={<DollarSign className="w-4 h-4 text-emerald-500" />} label={mr.totalReleasedCost} value={`${(kpis.totalReleasedCost ?? 0).toLocaleString()} ${mr.sar}`} color="emerald" />
                  <KpiCard icon={<Snowflake className="w-4 h-4 text-blue-500" />} label={mr.frozenCost} value={`${(kpis.frozenCost ?? 0).toLocaleString()} ${mr.sar}`} color="blue" />
                </div>
              )}

              {showCost && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-summary-profit">
                  <KpiCard icon={<TrendingUp className="w-4 h-4" />} label={mr.expectedProfit} value={`${kpis.totalReservedProfit.toLocaleString()} ${mr.sar}`} />
                  <KpiCard icon={<TrendingUp className="w-4 h-4 text-emerald-500" />} label={mr.actualProfit} value={`${kpis.totalReleasedProfit.toLocaleString()} ${mr.sar}`} color="emerald" />
                  <KpiCard icon={<Snowflake className="w-4 h-4 text-blue-500" />} label={mr.frozenProfit} value={`${kpis.frozenProfit.toLocaleString()} ${mr.sar}`} color="blue" />
                  <KpiCard icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} label={mr.expiringIn72h} value={kpis.expiringIn72h.toLocaleString()} color={kpis.expiringIn72h > 0 ? "amber" : undefined} />
                </div>
              )}

              {!showCost && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-summary-expiry">
                  <KpiCard icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} label={mr.expiringIn72h} value={kpis.expiringIn72h.toLocaleString()} color={kpis.expiringIn72h > 0 ? "amber" : undefined} />
                </div>
              )}

              {kpis.expiredUnreleased > 0 && (
                <Card className="border-destructive/50">
                  <CardContent className="p-3 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                    <span className="text-sm font-medium text-destructive">
                      {mr.expiredUnreleased}: {kpis.expiredUnreleased}
                    </span>
                  </CardContent>
                </Card>
              )}

            </>
          ) : null}
        </TabsContent>

        <TabsContent value="customer" className="mt-4">
          <ReportByDimension dimension="customer" title={mr.tabCustomer} icon={<Users className="w-5 h-5 text-primary" />} statusFilter={statusFilter} getDetailHref={(name) => `/reports/dim/customer/${encodeURIComponent(name)}`} />
        </TabsContent>
        <TabsContent value="project" className="mt-4">
          <ReportByDimension dimension="project" title={mr.tabProject} icon={<FolderKanban className="w-5 h-5 text-primary" />} statusFilter={statusFilter} getDetailHref={(name) => `/reports/dim/project/${encodeURIComponent(name)}`} />
        </TabsContent>
        <TabsContent value="product" className="mt-4">
          <ReportByDimension dimension="product" title={mr.tabProduct} icon={<Package className="w-5 h-5 text-primary" />} statusFilter={statusFilter} getDetailHref={(name) => `/reports/product/${encodeURIComponent(name)}`} />
        </TabsContent>
        <TabsContent value="branch" className="mt-4">
          <ReportByDimension dimension="branch" title={mr.tabBranch} icon={<Building2 className="w-5 h-5 text-primary" />} statusFilter={statusFilter} getDetailHref={(name) => `/reports/dim/branch/${encodeURIComponent(name)}`} />
        </TabsContent>
        <TabsContent value="brand" className="mt-4">
          <ReportByDimension dimension="brand" title={mr.tabBrand} icon={<Tag className="w-5 h-5 text-primary" />} statusFilter={statusFilter} getDetailHref={(name) => `/reports/dim/brand/${encodeURIComponent(name)}`} />
        </TabsContent>
        <TabsContent value="department" className="mt-4">
          <ReportByDimension dimension="department" title={mr.tabDepartment} icon={<Layers className="w-5 h-5 text-primary" />} statusFilter={statusFilter} getDetailHref={(name) => `/reports/dim/department/${encodeURIComponent(name)}`} />
        </TabsContent>
        <TabsContent value="category" className="mt-4">
          <ReportByDimension dimension="category" title={mr.tabCategory} icon={<Grid3X3 className="w-5 h-5 text-primary" />} statusFilter={statusFilter} getDetailHref={(name) => `/reports/category/${encodeURIComponent(name)}`} />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  const colorClass = color === "emerald"
    ? "text-emerald-600 dark:text-emerald-400"
    : color === "blue"
    ? "text-blue-600 dark:text-blue-400"
    : color === "amber"
    ? "text-amber-600 dark:text-amber-400"
    : color === "red"
    ? "text-red-600 dark:text-red-400"
    : color === "orange"
    ? "text-orange-600 dark:text-orange-400"
    : "";

  return (
    <div className="flex items-center gap-3 bg-muted/50 rounded-md px-4 py-4">
      <div className="shrink-0 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground leading-tight truncate">{label}</p>
        <p className={`text-base font-bold tabular-nums mt-1 ${colorClass}`}>{value}</p>
      </div>
    </div>
  );
}
