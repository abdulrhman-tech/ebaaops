import { useState, useRef, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportByDimension } from "@/components/report-by-dimension";

import { usePageTitle } from "@/hooks/use-page-title";
import { Link } from "wouter";
import { KPITooltip } from "@/components/kpi-tooltip";
import {
  Package, AlertTriangle, Clock, TrendingUp, TrendingDown,
  Minus, BarChart3, ShieldAlert, Timer, Filter, X, Download,
  DollarSign, Snowflake, FileText, Hourglass, Percent, Flame, Calendar,
  ChevronLeft, ChevronRight, Award, Zap, ShieldCheck, Target,
  Users, FolderOpen, Building2, Bookmark, Layers, Grid3X3,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title as ChartTitle,
  Tooltip as ChartTooltip,
  Legend as ChartLegend,
} from "chart.js";
import { Bar as ChartBar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTitle, ChartTooltip, ChartLegend);

interface PlanningReportData {
  kpis: {
    totalReservedQty: number;
    utilizationPercent: number;
    expiredCount: number;
    expiredReservedQty: number;
    releaseRate: number;
    avgDuration: number;
  };
  volumeOverTime: { date: string; count: number; reserved: number }[];
  reservationsByWarehouse: { warehouse: string; count: number; reserved: number }[];
  durationSplit: { name: string; value: number }[];
  highRiskSKUs: {
    skuCode: string; description: string; brand: string;
    reservedQty: number; availableQty: number; utilization: number; avgDuration: number;
  }[];
  policyViolations: {
    requestId: string; requestDbId: number; salesRep: string; duration: number;
    advancePayment: number | null; poAttached: boolean; warehouse: string; status: string;
  }[];
  expiringSoon: {
    requestId: string; requestDbId: number; projectName: string; salesRep: string;
    skuCount: number; totalReserved: number; daysRemaining: number;
  }[];
  filterOptions: {
    warehouses: string[];
    brands: string[];
    departments: string[];
    salesReps: { id: number; name: string }[];
  };
}

interface FinancialExposureData {
  kpis: {
    totalReservedValue: number;
    frozenValue: number;
    expectedGrossProfit: number;
    conversionRate: number;
  };
  health: {
    expiringSoon: number;
    expiredReservations: number;
    highRiskValue: number;
  };
  trendData: { date: string; reserved: number; released: number }[];
  reservedByBranch: { name: string; value: number }[];
  alertItems: { requestNumber: string; branch: string; reservedValue: number; expectedProfit: number; expiryDate: string; riskLevel: string; requestId: number }[];
}

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function PlanningReportsPage() {
  const { user, token } = useAuth();
  const { t, isRTL } = useLang();
  usePageTitle(t.planningReports.title);


  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    warehouse: "",
    brand: "",
    salesRepId: "",
    department: "",
  });

  const queryParams = new URLSearchParams();
  if (filters.dateFrom) queryParams.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) queryParams.set("dateTo", filters.dateTo);
  if (filters.warehouse) queryParams.set("warehouse", filters.warehouse);
  if (filters.brand) queryParams.set("brand", filters.brand);
  if (filters.salesRepId) queryParams.set("salesRepId", filters.salesRepId);
  if (filters.department) queryParams.set("department", filters.department);
  const qString = queryParams.toString();

  const [activeTab, setActiveTab] = useState<string>("main");
  const [execDateFrom, setExecDateFrom] = useState("");
  const [execDateTo, setExecDateTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [feExporting, setFeExporting] = useState(false);
  const [feDateFrom, setFeDateFrom] = useState("");
  const [feDateTo, setFeDateTo] = useState("");
  const [piDateFrom, setPiDateFrom] = useState("");
  const [piDateTo, setPiDateTo] = useState("");
  const [perfBranch, setPerfBranch] = useState("");

  const isAuthorized = !!user && (user.role === "planning" || user.role === "admin");

  const [irBranch, setIrBranch] = useState("");
  const [irWarehouse, setIrWarehouse] = useState("");
  const [irCategory, setIrCategory] = useState("");
  const [irRiskFilter, setIrRiskFilter] = useState("");
  const [irMinRatio, setIrMinRatio] = useState("");
  const [irExpiredOnly, setIrExpiredOnly] = useState(false);
  const [irPage, setIrPage] = useState(1);
  const IR_PAGE_SIZE = 15;

  const { data: irData, isLoading: irLoading } = useQuery<{
    kpis: {
      highRiskItems: number;
      expiredReservations: number;
      expiringSoon: number;
      lowStockAlerts: number;
    };
    products: {
      code: string;
      desc: string;
      reserved: number;
      available: number;
      reservedRatio: number;
      daysToExpiry: number | null;
      riskScore: number;
      riskLevel: string;
      expired: boolean;
      expiringSoon: boolean;
      branches: string[];
      warehouses: string[];
      categories: string[];
    }[];
    filters: {
      branches: string[];
      warehouses: string[];
      categories: string[];
    };
  }>({
    queryKey: ["/api/reports/inventory-risk"],
    queryFn: async () => {
      const res = await fetch("/api/reports/inventory-risk", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load inventory risk data");
      return res.json();
    },
    enabled: !!token && isAuthorized && activeTab === "inventory",
  });

  const irFilteredProducts = useMemo(() => {
    if (!irData?.products) return [];
    let list = irData.products;
    if (irBranch) list = list.filter(p => p.branches.includes(irBranch));
    if (irWarehouse) list = list.filter(p => p.warehouses.includes(irWarehouse));
    if (irCategory) list = list.filter(p => p.categories.includes(irCategory));
    if (irRiskFilter) list = list.filter(p => p.riskLevel === irRiskFilter);
    if (irMinRatio && !isNaN(Number(irMinRatio))) list = list.filter(p => p.reservedRatio > Number(irMinRatio));
    if (irExpiredOnly) list = list.filter(p => p.expired);
    return list;
  }, [irData, irBranch, irWarehouse, irCategory, irRiskFilter, irMinRatio, irExpiredOnly]);

  const irTotalPages = Math.max(1, Math.ceil(irFilteredProducts.length / IR_PAGE_SIZE));
  const irPagedProducts = irFilteredProducts.slice((irPage - 1) * IR_PAGE_SIZE, irPage * IR_PAGE_SIZE);

  useEffect(() => { setIrPage(1); }, [irBranch, irWarehouse, irCategory, irRiskFilter, irMinRatio, irExpiredOnly]);

  const [perfDateFrom, setPerfDateFrom] = useState("");
  const [perfDateTo, setPerfDateTo] = useState("");
  const [perfRepId, setPerfRepId] = useState("");
  const [perfActiveOnly, setPerfActiveOnly] = useState(false);
  const [perfPage, setPerfPage] = useState(1);
  const PERF_PAGE_SIZE = 10;

  const [ppCategory, setPpCategory] = useState("");
  const [ppBrand, setPpBrand] = useState("");
  const [ppWarehouse, setPpWarehouse] = useState("");
  const [ppDateFrom, setPpDateFrom] = useState("");
  const [ppDateTo, setPpDateTo] = useState("");
  const [ppPage, setPpPage] = useState(1);
  const PP_PAGE_SIZE = 15;

  type PPProduct = {
    code: string; description: string; brand: string; category: string;
    costPrice: number; sellingPrice: number; availableQuantity: number;
    totalRequested: number; totalReleased: number; requestCount: number;
    totalProfit: number; potentialProfit: number; marginPercent: number;
    turnoverRate: number; reservationRatio: number; inventoryValue: number;
    potentialRevenue: number; warehouses: string[];
  };
  type PPData = {
    kpis: {
      totalProducts: number; totalInventoryValue: number; totalPotentialSalesValue: number;
      topProfitProduct: { code: string; description: string; profit: number } | null;
      avgMargin: number; frozenCapitalValue: number;
    };
    products: PPProduct[];
    charts: {
      top10Revenue: { name: string; code: string; revenue: number }[];
      top10Profit: { name: string; code: string; profit: number }[];
      categoryChart: { name: string; count: number; value: number; profit: number }[];
    };
    insights: {
      slowMovingCount: number; slowMovingValue: number; highDemandCount: number;
      topHighDemand: { code: string; description: string; gap: number }[];
      highMarginCount: number; topHighMargin: { code: string; description: string; margin: number }[];
      frozenCapitalCount: number;
    };
    filters: { categories: string[]; brands: string[]; warehouses: string[] };
  };

  const ppQP = new URLSearchParams();
  if (ppCategory) ppQP.set("category", ppCategory);
  if (ppBrand) ppQP.set("brand", ppBrand);
  if (ppWarehouse) ppQP.set("warehouse", ppWarehouse);
  if (ppDateFrom) ppQP.set("dateFrom", ppDateFrom);
  if (ppDateTo) ppQP.set("dateTo", ppDateTo);
  const ppQS = ppQP.toString();

  const { data: ppData, isLoading: ppLoading } = useQuery<PPData>({
    queryKey: ["/api/reports/product-performance", ppQS],
    queryFn: async () => {
      const res = await fetch(`/api/reports/product-performance${ppQS ? `?${ppQS}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load product performance data");
      return res.json();
    },
    enabled: !!token && isAuthorized && activeTab === "product",
  });

  const ppTotalPages = Math.max(1, Math.ceil((ppData?.products?.length || 0) / PP_PAGE_SIZE));
  const ppPagedProducts = (ppData?.products || []).slice((ppPage - 1) * PP_PAGE_SIZE, ppPage * PP_PAGE_SIZE);
  useEffect(() => { setPpPage(1); }, [ppCategory, ppBrand, ppWarehouse, ppDateFrom, ppDateTo]);

  const perfQP = new URLSearchParams();
  if (perfBranch) perfQP.set("branch", perfBranch);
  if (perfDateFrom) perfQP.set("dateFrom", perfDateFrom);
  if (perfDateTo) perfQP.set("dateTo", perfDateTo);
  if (perfRepId) perfQP.set("salesRepId", perfRepId);
  if (perfActiveOnly) perfQP.set("activeOnly", "true");
  const perfQS = perfQP.toString();

  type PerfRepRow = {
    rank: number; id: number; name: string; branch: string;
    totalOrders: number; approvedOrders: number; rejectedOrders: number;
    rejectionRate: number; conversionRate: number; profitMargin: number;
    avgApprovalHours: number; expectedRevenue: number; actualRevenue: number;
    expectedProfit: number; actualProfit: number;
  };
  type PerfData = {
    kpis: { actualRevenue: number; expectedRevenue: number; avgApprovalTimeHours: number; rejectionRate: number; profitMargin: number; conversionRate: number };
    repRanking: PerfRepRow[];
    approvalTrend: { date: string; avgHours: number }[];
    statusSplit: { approved: number; rejected: number; pending: number };
    insights: {
      topPerformer: { name: string; actualProfit: number } | null;
      slowestApprover: { name: string; avgHours: number } | null;
      highestRejRisk: { name: string; rate: number } | null;
      mostProfitable: { name: string; margin: number } | null;
    };
    filters: { branches: string[]; salesReps: { id: number; name: string }[] };
  };

  const { data: perfData, isLoading: perfLoading } = useQuery<PerfData>({
    queryKey: ["/api/reports/performance", perfQS],
    queryFn: async () => {
      const res = await fetch(`/api/reports/performance${perfQS ? `?${perfQS}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load performance data");
      return res.json();
    },
    enabled: !!token && isAuthorized && activeTab === "performance",
  });

  const perfTotalPages = Math.max(1, Math.ceil((perfData?.repRanking?.length || 0) / PERF_PAGE_SIZE));
  const perfPagedRanking = (perfData?.repRanking || []).slice((perfPage - 1) * PERF_PAGE_SIZE, perfPage * PERF_PAGE_SIZE);
  useEffect(() => { setPerfPage(1); }, [perfBranch, perfDateFrom, perfDateTo, perfRepId, perfActiveOnly]);

  const { data, isLoading } = useQuery<PlanningReportData>({
    queryKey: ["/api/planning-reports", qString],
    queryFn: async () => {
      const res = await fetch(`/api/planning-reports${qString ? `?${qString}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load reports");
      return res.json();
    },
    enabled: !!token && isAuthorized,
  });

  const execQP = new URLSearchParams();
  if (execDateFrom) execQP.set("dateFrom", execDateFrom);
  if (execDateTo) execQP.set("dateTo", execDateTo);
  const execQS = execQP.toString();

  const { data: execData, isLoading: execLoading } = useQuery<{
    totalReservedValue: number;
    totalReleasedValue: number;
    frozenValue: number;
    expectedGrossProfit: number;
    conversionRate: number;
    avgApprovalTimeHours: number;
    health: { expiringSoon: number; expiredReservations: number; highRiskReservations: number };
    trendData: { date: string; reserved: number; released: number }[];
    reservedByBranch: { name: string; value: number }[];
    alertItems: { requestNumber: string; branch: string; reservedValue: number; expiryDate: string; riskLevel: string; requestId: number }[];
  }>({
    queryKey: ["/api/reports/executive-overview", execQS],
    queryFn: async () => {
      const res = await fetch(`/api/reports/executive-overview${execQS ? `?${execQS}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load executive overview");
      return res.json();
    },
    enabled: !!token && isAuthorized,
  });

  const feQP = new URLSearchParams();
  if (feDateFrom) feQP.set("dateFrom", feDateFrom);
  if (feDateTo) feQP.set("dateTo", feDateTo);
  const feQS = feQP.toString();

  const { data: feData, isLoading: feLoading } = useQuery<FinancialExposureData>({
    queryKey: ["/api/reports/financial-exposure", feQS],
    queryFn: async () => {
      const res = await fetch(`/api/reports/financial-exposure${feQS ? `?${feQS}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load financial exposure");
      return res.json();
    },
    enabled: !!token && isAuthorized && activeTab === "financial",
  });

  const piQP = new URLSearchParams();
  if (piDateFrom) piQP.set("dateFrom", piDateFrom);
  if (piDateTo) piQP.set("dateTo", piDateTo);
  const piQS = piQP.toString();

  const { data: piData, isLoading: piLoading } = useQuery<{
    kpis: {
      expectedGrossProfit: number;
      actualGrossProfit: number;
      frozenProfit: number;
      avgMargin: number;
    };
    profitByBranch: { name: string; value: number }[];
    profitBySalesRep: { name: string; value: number }[];
    topProducts: { code: string; desc: string; profit: number; margin: number; reservedQty: number }[];
  }>({
    queryKey: ["/api/reports/profit", piQS],
    queryFn: async () => {
      const res = await fetch(`/api/reports/profit${piQS ? `?${piQS}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load profit data");
      return res.json();
    },
    enabled: !!token && isAuthorized && activeTab === "profit",
  });

  if (!isAuthorized) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t.planningReports.title} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">{t.planningReports.accessDenied}</p>
        </div>
      </div>
    );
  }
  const hasActiveFilters = Object.values(filters).some(v => v !== "");

  function clearFilters() {
    setFilters({ dateFrom: "", dateTo: "", warehouse: "", brand: "", salesRepId: "", department: "" });
  }

  async function handleExportExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      if (filters.warehouse) params.set("warehouse", filters.warehouse);
      if (filters.brand) params.set("brand", filters.brand);
      if (filters.salesRepId) params.set("salesRepId", filters.salesRepId);
      if (filters.department) params.set("department", filters.department);
      const qs = params.toString();
      const response = await fetch(`/api/reports/planning/export${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Planning_Report_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  }

  async function handleFeExportExcel() {
    setFeExporting(true);
    try {
      const params = new URLSearchParams();
      if (feDateFrom) params.set("dateFrom", feDateFrom);
      if (feDateTo) params.set("dateTo", feDateTo);
      const qs = params.toString();
      const response = await fetch(`/api/reports/financial-exposure/export${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Financial_Exposure_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setFeExporting(false);
    }
  }



  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.planningReports.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6" dir={isRTL ? "rtl" : "ltr"}>

        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tab-switcher">
          <div className="overflow-x-auto scrollbar-thin pb-1">
            <div className="flex items-center gap-1 min-w-max">
              {(() => {
                const tabGroups = [
                  {
                    label: isRTL ? "الرئيسية" : "Main",
                    tabs: [
                      { value: "main", icon: BarChart3, label: t.planningReports.feMainTab },
                    ],
                  },
                  {
                    label: isRTL ? "تحليلي" : "Analytical",
                    tabs: [
                      { value: "customer", icon: Users, label: t.planningReports.tabCustomer },
                      { value: "project", icon: FolderOpen, label: t.planningReports.tabProject },
                      { value: "product", icon: Package, label: t.planningReports.ppTab },
                      { value: "branch", icon: Building2, label: t.planningReports.tabBranch },
                      { value: "brand", icon: Bookmark, label: t.planningReports.tabBrand },
                      { value: "department", icon: Layers, label: t.planningReports.tabDepartment },
                      { value: "category", icon: Grid3X3, label: t.planningReports.tabCategory },
                    ],
                  },
                  {
                    label: isRTL ? "متقدم" : "Advanced",
                    tabs: [
                      { value: "financial", icon: DollarSign, label: t.planningReports.feTab },
                      { value: "profit", icon: TrendingUp, label: t.planningReports.piTab },
                      { value: "inventory", icon: AlertTriangle, label: t.planningReports.irTab },
                      { value: "performance", icon: Timer, label: t.planningReports.perfTab },
                    ],
                  },
                ];
                return tabGroups.map((group, gi) => (
                  <div key={gi} className="flex items-center gap-1">
                    {gi > 0 && (
                      <div className="h-5 w-px bg-border/60 mx-1.5 flex-shrink-0" />
                    )}
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1 flex-shrink-0 hidden md:inline">
                      {group.label}
                    </span>
                    {group.tabs.map((tab) => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.value;
                      return (
                        <button
                          key={tab.value}
                          onClick={() => setActiveTab(tab.value)}
                          data-testid={`button-tab-${tab.value}`}
                          className={`
                            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                            transition-all duration-150 whitespace-nowrap flex-shrink-0
                            ${isActive
                              ? "bg-background text-primary shadow-sm ring-1 ring-border/50 font-semibold"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            }
                          `}
                        >
                          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          </div>

          <TabsContent value="customer">
            <ReportByDimension dimension="customer" title={t.planningReports.tabCustomer} icon={<Users className="w-5 h-5 text-muted-foreground" />} />
          </TabsContent>
          <TabsContent value="project">
            <ReportByDimension dimension="project" title={t.planningReports.tabProject} icon={<FolderOpen className="w-5 h-5 text-muted-foreground" />} />
          </TabsContent>
          <TabsContent value="branch">
            <ReportByDimension dimension="branch" title={t.planningReports.tabBranch} icon={<Building2 className="w-5 h-5 text-muted-foreground" />} />
          </TabsContent>
          <TabsContent value="brand">
            <ReportByDimension dimension="brand" title={t.planningReports.tabBrand} icon={<Bookmark className="w-5 h-5 text-muted-foreground" />} />
          </TabsContent>
          <TabsContent value="department">
            <ReportByDimension dimension="department" title={t.planningReports.tabDepartment} icon={<Layers className="w-5 h-5 text-muted-foreground" />} />
          </TabsContent>
          <TabsContent value="category">
            <ReportByDimension dimension="category" title={t.planningReports.tabCategory} icon={<Grid3X3 className="w-5 h-5 text-muted-foreground" />} />
          </TabsContent>

        <TabsContent value="financial">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">{t.planningReports.financialExposure}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t.planningReports.from}</label>
                  <Input
                    type="date"
                    value={feDateFrom}
                    onChange={(e) => setFeDateFrom(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-fe-date-from"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t.planningReports.to}</label>
                  <Input
                    type="date"
                    value={feDateTo}
                    onChange={(e) => setFeDateTo(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-fe-date-to"
                  />
                </div>
                {(feDateFrom || feDateTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setFeDateFrom(""); setFeDateTo(""); }} data-testid="button-fe-clear-dates">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleFeExportExcel}
                  disabled={feExporting || feLoading}
                  data-testid="button-fe-download-excel"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{feExporting ? t.planningReports.exporting : t.planningReports.feExportExcel}</span>
                </Button>
              </div>
            </div>

            {feLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <Card key={i}>
                    <CardContent className="p-5 space-y-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-8 w-20" />
                      <Skeleton className="h-3 w-16" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : feData ? (
              <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-fe-kpis">
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-muted-foreground font-medium">{t.planningReports.feReservedValue}</p>
                      <KPITooltip 
                        title={t.planningReports.kpiTooltips.totalReservedValue.title}
                        definition={t.planningReports.kpiTooltips.totalReservedValue.definition}
                        calculation={t.planningReports.kpiTooltips.totalReservedValue.calculation}
                        importance={t.planningReports.kpiTooltips.totalReservedValue.importance}
                        riskNote={t.planningReports.kpiTooltips.totalReservedValue.risk}
                      />
                    </div>
                    <DollarSign className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-fe-reserved-value">{feData.kpis.totalReservedValue.toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{t.planningReports.feSar}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-muted-foreground font-medium">{t.planningReports.feFrozenValue}</p>
                      <KPITooltip 
                        title={t.planningReports.kpiTooltips.frozenValue.title}
                        definition={t.planningReports.kpiTooltips.frozenValue.definition}
                        calculation={t.planningReports.kpiTooltips.frozenValue.calculation}
                        importance={t.planningReports.kpiTooltips.frozenValue.importance}
                        riskNote={t.planningReports.kpiTooltips.frozenValue.risk}
                      />
                    </div>
                    <Snowflake className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-fe-frozen-value">{feData.kpis.frozenValue.toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{t.planningReports.feFrozenDesc}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-muted-foreground font-medium">{t.planningReports.feExpectedProfit}</p>
                      <KPITooltip 
                        title={t.planningReports.kpiTooltips.expectedProfit.title}
                        definition={t.planningReports.kpiTooltips.expectedProfit.definition}
                        calculation={t.planningReports.kpiTooltips.expectedProfit.calculation}
                        importance={t.planningReports.kpiTooltips.expectedProfit.importance}
                        riskNote={t.planningReports.kpiTooltips.expectedProfit.risk}
                      />
                    </div>
                    <TrendingUp className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-fe-expected-profit">{feData.kpis.expectedGrossProfit.toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{t.planningReports.feSar}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-1 mb-2">
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-muted-foreground font-medium">{t.planningReports.feConversionRate}</p>
                      <KPITooltip 
                        title={t.planningReports.kpiTooltips.conversionRate.title}
                        definition={t.planningReports.kpiTooltips.conversionRate.definition}
                        calculation={t.planningReports.kpiTooltips.conversionRate.calculation}
                        importance={t.planningReports.kpiTooltips.conversionRate.importance}
                        riskNote={t.planningReports.kpiTooltips.conversionRate.risk}
                      />
                    </div>
                    <Percent className="w-4 h-4 text-teal-500 flex-shrink-0" />
                  </div>
                  <p className={`text-2xl font-bold ${feData.kpis.conversionRate > 70 ? "text-emerald-600 dark:text-emerald-400" : feData.kpis.conversionRate > 40 ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`} data-testid="text-fe-conversion-rate">{feData.kpis.conversionRate}%</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{t.planningReports.feConversionRate}</p>
                </CardContent>
              </Card>
            </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="section-health">
                  {[
                    { 
                      label: t.planningReports.feExpiringSoon, 
                      value: feData.health.expiringSoon, 
                      desc: t.planningReports.feSar,
                      tooltip: t.planningReports.kpiTooltips.expiringSoon
                    },
                    { 
                      label: t.planningReports.feExpiredReservations, 
                      value: feData.health.expiredReservations, 
                      desc: "",
                      tooltip: t.planningReports.kpiTooltips.expiredReservations
                    },
                    { 
                      label: t.planningReports.feHighRiskValue, 
                      value: feData.health.highRiskValue, 
                      desc: t.planningReports.feSar,
                      tooltip: t.planningReports.kpiTooltips.highRiskValue
                    },
                  ].map((h, i) => {
                    const color = h.value === 0 ? "text-emerald-600 dark:text-emerald-400" : h.value <= 2 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
                    const bg = h.value === 0 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" : h.value <= 2 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
                    return (
                      <Card key={i} className={`border ${bg}`} data-testid={`card-fe-health-${i}`}>
                        <CardContent className="p-4 flex items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1">
                              <p className="text-xs text-muted-foreground">{h.label}</p>
                              <KPITooltip 
                                title={h.tooltip.title}
                                definition={h.tooltip.definition}
                                calculation={h.tooltip.calculation}
                                importance={h.tooltip.importance}
                                riskNote={h.tooltip.risk}
                              />
                            </div>
                            <p className={`text-2xl font-bold ${color}`}>
                              {typeof h.value === 'number' && h.value === 0 ? t.planningReports.feHealthy : h.value.toLocaleString()}
                            </p>
                            {h.desc && <p className="text-[10px] text-muted-foreground">{h.desc}</p>}
                          </div>
                          {i === 0 ? <Hourglass className={`w-5 h-5 ${color} flex-shrink-0`} /> : i === 1 ? <AlertTriangle className={`w-5 h-5 ${color} flex-shrink-0`} /> : <Flame className={`w-5 h-5 ${color} flex-shrink-0`} />}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="section-fe-charts">
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{t.planningReports.feReservedVsReleased}</span>
                        <span className="text-xs text-muted-foreground">{t.planningReports.feLast30}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {feData.trendData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={feData.trendData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} reversed={isRTL} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString()} orientation={isRTL ? "right" : "left"} />
                            <Tooltip formatter={(v: number) => [v.toLocaleString() + ` ${t.planningReports.feSar}`, ""]} labelFormatter={(l) => l} contentStyle={{ direction: isRTL ? "rtl" : "ltr" }} />
                            <Legend />
                            <Line type="monotone" dataKey="reserved" name={t.planningReports.feReserved} stroke="#3b82f6" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="released" name={t.planningReports.feReleased} stroke="#10b981" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <span className="text-sm font-semibold">{t.planningReports.feByBranch}</span>
                    </CardHeader>
                    <CardContent>
                      {feData.reservedByBranch.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={feData.reservedByBranch} layout="vertical" margin={isRTL ? { left: 20, right: 80, top: 10, bottom: 10 } : { left: 80, right: 20, top: 10, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} reversed={isRTL} />
                            <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} orientation={isRTL ? "right" : "left"} />
                            <Tooltip formatter={(v: number) => [v.toLocaleString() + ` ${t.planningReports.feSar}`, ""]} contentStyle={{ direction: isRTL ? "rtl" : "ltr" }} />
                            <Bar dataKey="value" fill="hsl(var(--primary))" radius={isRTL ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {feData.alertItems.length > 0 && (
                  <Card data-testid="card-fe-alerts">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-destructive" />
                        <span className="text-sm font-semibold">{t.planningReports.feAlertsTable}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.feAlertReqNo}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.feAlertBranch}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.feAlertValue}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.feAlertProfit}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.feAlertExpiry}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.feAlertRisk}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {feData.alertItems.map((item, i) => (
                              <TableRow key={i} data-testid={`row-fe-alert-${i}`}>
                                <TableCell>
                                  <Link href={`/requests/${item.requestId}`}>
                                    <span className="text-primary cursor-pointer hover:underline font-mono text-xs">{item.requestNumber}</span>
                                  </Link>
                                </TableCell>
                                <TableCell>{item.branch}</TableCell>
                                <TableCell className={`${isRTL ? "text-right" : "text-left"} tabular-nums`}>{item.reservedValue.toLocaleString()} {t.planningReports.feSar}</TableCell>
                                <TableCell className={`${isRTL ? "text-right" : "text-left"} tabular-nums`}>{item.expectedProfit.toLocaleString()} {t.planningReports.feSar}</TableCell>
                                <TableCell className="tabular-nums">{item.expiryDate}</TableCell>
                                <TableCell>
                                  <Badge variant={item.riskLevel === "expired" ? "destructive" : item.riskLevel === "high" ? "secondary" : "outline"}>
                                    {item.riskLevel === "expired" ? t.planningReports.feRiskExpired : item.riskLevel === "high" ? t.planningReports.feRiskHigh : t.planningReports.feRiskLow}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="profit">
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">{t.planningReports.profitIntelligence}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t.planningReports.from}</label>
                  <Input
                    type="date"
                    value={piDateFrom}
                    onChange={(e) => setPiDateFrom(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-pi-date-from"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t.planningReports.to}</label>
                  <Input
                    type="date"
                    value={piDateTo}
                    onChange={(e) => setPiDateTo(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-pi-date-to"
                  />
                </div>
                {(piDateFrom || piDateTo) && (
                  <Button variant="ghost" size="icon" onClick={() => { setPiDateFrom(""); setPiDateTo(""); }} data-testid="button-pi-clear-dates">
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {piLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-md" />)
              ) : piData ? (
                <>
                  <Card data-testid="kpi-expected-profit">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-1 mb-2">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.piExpectedProfit || 'Expected Gross Profit'}</p>
                            <KPITooltip 
                              title={t.planningReports.kpiTooltips.expectedProfit.title}
                              definition={t.planningReports.kpiTooltips.expectedProfit.definition}
                              calculation={t.planningReports.kpiTooltips.expectedProfit.calculation}
                              importance={t.planningReports.kpiTooltips.expectedProfit.importance}
                              riskNote={t.planningReports.kpiTooltips.expectedProfit.risk}
                            />
                          </div>
                      </div>
                      <p className="text-3xl font-bold tracking-tight">{(piData.kpis.expectedGrossProfit ?? 0).toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{t.planningReports.feSar}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-actual-profit">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-1 mb-2">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.piActualProfit || 'Actual Gross Profit'}</p>
                            <KPITooltip 
                              title={t.planningReports.kpiTooltips.totalReleasedValue.title}
                              definition={t.planningReports.kpiTooltips.totalReleasedValue.definition}
                              calculation={t.planningReports.kpiTooltips.totalReleasedValue.calculation}
                              importance={t.planningReports.kpiTooltips.totalReleasedValue.importance}
                              riskNote={t.planningReports.kpiTooltips.totalReleasedValue.risk}
                            />
                          </div>
                      </div>
                      <p className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{(piData.kpis.actualGrossProfit ?? 0).toLocaleString()}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {piData.kpis.expectedGrossProfit > 0 && (
                          <>
                            {piData.kpis.actualGrossProfit >= piData.kpis.expectedGrossProfit * 0.8 ? (
                              <TrendingUp className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-destructive" />
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round((piData.kpis.actualGrossProfit / piData.kpis.expectedGrossProfit) * 100)}%
                            </span>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-frozen-profit">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-1 mb-2">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.piFrozenProfit || 'Frozen Profit'}</p>
                            <KPITooltip 
                              title={t.planningReports.kpiTooltips.frozenValue.title}
                              definition={t.planningReports.kpiTooltips.frozenValue.definition}
                              calculation={t.planningReports.kpiTooltips.frozenValue.calculation}
                              importance={t.planningReports.kpiTooltips.frozenValue.importance}
                              riskNote={t.planningReports.kpiTooltips.frozenValue.risk}
                            />
                          </div>
                      </div>
                      <p className="text-3xl font-bold tracking-tight text-blue-600 dark:text-blue-400">{(piData.kpis.frozenProfit ?? 0).toLocaleString()}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {piData.kpis.expectedGrossProfit > 0 && (
                          <>
                            <Snowflake className="w-3 h-3 text-blue-500" />
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round((piData.kpis.frozenProfit / piData.kpis.expectedGrossProfit) * 100)}%
                            </span>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-avg-margin">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div className="flex items-center gap-1">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.piAvgMargin || 'Avg Margin %'}</p>
                            <KPITooltip 
                              title={t.planningReports.kpiTooltips.avgMargin.title}
                              definition={t.planningReports.kpiTooltips.avgMargin.definition}
                              calculation={t.planningReports.kpiTooltips.avgMargin.calculation}
                              importance={t.planningReports.kpiTooltips.avgMargin.importance}
                              riskNote={t.planningReports.kpiTooltips.avgMargin.risk}
                            />
                          </div>
                        </div>
                      </div>
                      <p className={`text-3xl font-bold tracking-tight ${(piData.kpis.avgMargin ?? 0) < 10 ? "text-destructive" : ""}`}>
                        {piData.kpis.avgMargin ?? 0}%
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        {(piData.kpis.avgMargin ?? 0) >= 10 ? (
                          <TrendingUp className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <TrendingDown className="w-3 h-3 text-destructive" />
                        )}
                        <span className={`text-[10px] font-medium ${(piData.kpis.avgMargin ?? 0) < 10 ? "text-destructive" : "text-muted-foreground"}`}>
                          {(piData.kpis.avgMargin ?? 0) < 10 ? t.planningReports.piLowMargin : ""}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card data-testid="chart-profit-by-sales-rep">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold">{t.planningReports.piProfitBySalesRep}</span>
                    <KPITooltip 
                      title={t.planningReports.kpiTooltips.piProfitByRepTooltip.title}
                      definition={t.planningReports.kpiTooltips.piProfitByRepTooltip.definition}
                      calculation={t.planningReports.kpiTooltips.piProfitByRepTooltip.calculation}
                      importance={t.planningReports.kpiTooltips.piProfitByRepTooltip.importance}
                      riskNote={t.planningReports.kpiTooltips.piProfitByRepTooltip.risk}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {piLoading ? <Skeleton className="h-[260px] w-full" /> : piData && piData.profitBySalesRep.length > 0 ? (
                    <div style={{ height: 260 }}>
                      <ChartBar
                        data={{
                          labels: piData.profitBySalesRep.map((s: any) => s.name),
                          datasets: [{
                            label: t.planningReports.piProfit,
                            data: piData.profitBySalesRep.map((s: any) => s.value),
                            backgroundColor: CHART_COLORS[1],
                            borderRadius: 4,
                          }],
                        }}
                        options={{
                          indexAxis: "y" as const,
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              rtl: isRTL,
                              callbacks: {
                                label: (ctx: any) => `${ctx.formattedValue} ${t.planningReports.feSar}`,
                              },
                            },
                          },
                          scales: {
                            x: {
                              position: isRTL ? "top" : "bottom",
                              ticks: { callback: (v: any) => Number(v).toLocaleString() },
                            },
                            y: {
                              position: isRTL ? "right" : "left",
                            },
                          },
                        }}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">{t.planningReports.noData}</p>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="chart-profit-by-branch">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold">{t.planningReports.piProfitByBranch}</span>
                    <KPITooltip 
                      title={t.planningReports.kpiTooltips.piProfitByBranchTooltip.title}
                      definition={t.planningReports.kpiTooltips.piProfitByBranchTooltip.definition}
                      calculation={t.planningReports.kpiTooltips.piProfitByBranchTooltip.calculation}
                      importance={t.planningReports.kpiTooltips.piProfitByBranchTooltip.importance}
                      riskNote={t.planningReports.kpiTooltips.piProfitByBranchTooltip.risk}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {piLoading ? <Skeleton className="h-[260px] w-full" /> : piData && piData.profitByBranch.length > 0 ? (
                    <div style={{ height: 260 }}>
                      <ChartBar
                        data={{
                          labels: piData.profitByBranch.map((b: any) => b.name),
                          datasets: [{
                            label: t.planningReports.piProfit,
                            data: piData.profitByBranch.map((b: any) => b.value),
                            backgroundColor: CHART_COLORS[0],
                            borderRadius: 4,
                          }],
                        }}
                        options={{
                          indexAxis: "y" as const,
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              rtl: isRTL,
                              callbacks: {
                                label: (ctx: any) => `${ctx.formattedValue} ${t.planningReports.feSar}`,
                              },
                            },
                          },
                          scales: {
                            x: {
                              position: isRTL ? "top" : "bottom",
                              ticks: { callback: (v: any) => Number(v).toLocaleString() },
                            },
                            y: {
                              position: isRTL ? "right" : "left",
                            },
                          },
                        }}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">{t.planningReports.noData}</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card data-testid="table-top-products">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold">{t.planningReports.piTopProducts}</span>
                  <KPITooltip 
                    title={t.planningReports.kpiTooltips.piTopProductsTooltip.title}
                    definition={t.planningReports.kpiTooltips.piTopProductsTooltip.definition}
                    calculation={t.planningReports.kpiTooltips.piTopProductsTooltip.calculation}
                    importance={t.planningReports.kpiTooltips.piTopProductsTooltip.importance}
                    riskNote={t.planningReports.kpiTooltips.piTopProductsTooltip.risk}
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="p-3 text-start font-medium">{t.planningReports.piProductCode}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.piDescription}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.piExpProfit}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.piMargin}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.piReservedQty}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {piLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                            <td className="p-3"><Skeleton className="h-4 w-32" /></td>
                            <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                            <td className="p-3"><Skeleton className="h-4 w-12" /></td>
                            <td className="p-3"><Skeleton className="h-4 w-12" /></td>
                          </tr>
                        ))
                      ) : piData?.topProducts.map((p: any, i: number) => (
                        <tr key={i} className="border-b" data-testid={`row-product-${i}`}>
                          <td className="p-3 font-mono text-xs">{p.code}</td>
                          <td className="p-3 max-w-[200px] truncate">{p.desc}</td>
                          <td className="p-3 font-semibold">{Math.round(p.profit).toLocaleString()}</td>
                          <td className="p-3">
                            {p.margin < 10 ? (
                              <Badge variant="destructive" className="text-xs">{Math.round(p.margin)}%</Badge>
                            ) : (
                              <span className="font-medium">{Math.round(p.margin)}%</span>
                            )}
                          </td>
                          <td className="p-3 font-medium">{(p.reservedQty ?? 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        </TabsContent>

        <TabsContent value="main">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">{t.planningReports.executiveOverview}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t.planningReports.from}</label>
                  <Input
                    type="date"
                    value={execDateFrom}
                    onChange={(e) => setExecDateFrom(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-exec-date-from"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">{t.planningReports.to}</label>
                  <Input
                    type="date"
                    value={execDateTo}
                    onChange={(e) => setExecDateTo(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-exec-date-to"
                  />
                </div>
                {(execDateFrom || execDateTo) && (
                  <Button variant="ghost" size="icon" onClick={() => { setExecDateFrom(""); setExecDateTo(""); }} data-testid="button-exec-clear-dates">
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {execLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-28 rounded-md" />)}
              </div>
            ) : execData ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-exec-kpis">
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground mb-1">{t.planningReports.execTotalReservedValue}</p>
                          <KPITooltip 
                            title={t.planningReports.kpiTooltips.totalReservedValue.title}
                            definition={t.planningReports.kpiTooltips.totalReservedValue.definition}
                            calculation={t.planningReports.kpiTooltips.totalReservedValue.calculation}
                            importance={t.planningReports.kpiTooltips.totalReservedValue.importance}
                            riskNote={t.planningReports.kpiTooltips.totalReservedValue.risk}
                          />
                        </div>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" data-testid="text-exec-reserved-value">{execData.totalReservedValue.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t.planningReports.execSar}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground mb-1">{t.planningReports.execTotalReleasedValue}</p>
                          <KPITooltip 
                            title={t.planningReports.kpiTooltips.totalReleasedValue.title}
                            definition={t.planningReports.kpiTooltips.totalReleasedValue.definition}
                            calculation={t.planningReports.kpiTooltips.totalReleasedValue.calculation}
                            importance={t.planningReports.kpiTooltips.totalReleasedValue.importance}
                            riskNote={t.planningReports.kpiTooltips.totalReleasedValue.risk}
                          />
                        </div>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" data-testid="text-exec-released-value">{execData.totalReleasedValue.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t.planningReports.execSar}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground mb-1">{t.planningReports.execFrozenValue}</p>
                          <KPITooltip 
                            title={t.planningReports.kpiTooltips.frozenValue.title}
                            definition={t.planningReports.kpiTooltips.frozenValue.definition}
                            calculation={t.planningReports.kpiTooltips.frozenValue.calculation}
                            importance={t.planningReports.kpiTooltips.frozenValue.importance}
                            riskNote={t.planningReports.kpiTooltips.frozenValue.risk}
                          />
                        </div>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" data-testid="text-exec-frozen-value">{execData.frozenValue.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t.planningReports.execFrozenDesc}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground mb-1">{t.planningReports.execExpectedProfit}</p>
                          <KPITooltip 
                            title={t.planningReports.kpiTooltips.expectedProfit.title}
                            definition={t.planningReports.kpiTooltips.expectedProfit.definition}
                            calculation={t.planningReports.kpiTooltips.expectedProfit.calculation}
                            importance={t.planningReports.kpiTooltips.expectedProfit.importance}
                            riskNote={t.planningReports.kpiTooltips.expectedProfit.risk}
                          />
                        </div>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" data-testid="text-exec-expected-profit">{execData.expectedGrossProfit.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t.planningReports.execSar}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground mb-1">{t.planningReports.execConversionRate}</p>
                          <KPITooltip 
                            title={t.planningReports.execConversionRate}
                            definition={t.planningReports.kpiTooltips.conversionRate.definition}
                            calculation={t.planningReports.kpiTooltips.conversionRate.calculation}
                            importance={t.planningReports.kpiTooltips.conversionRate.importance}
                            riskNote={t.planningReports.kpiTooltips.conversionRate.risk}
                          />
                        </div>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" data-testid="text-exec-conversion">{execData.conversionRate}%</p>
                      <p className="text-xs text-muted-foreground mt-1">{isRTL ? "محجوز → مصروف" : "Reserved → Released"}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground mb-1">{t.planningReports.execAvgApprovalTime}</p>
                          <KPITooltip 
                            title={t.planningReports.kpiTooltips.avgApprovalTime.title}
                            definition={t.planningReports.kpiTooltips.avgApprovalTime.definition}
                            calculation={t.planningReports.kpiTooltips.avgApprovalTime.calculation}
                            importance={t.planningReports.kpiTooltips.avgApprovalTime.importance}
                            riskNote={t.planningReports.kpiTooltips.avgApprovalTime.risk}
                          />
                        </div>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" data-testid="text-exec-avg-approval">{execData.avgApprovalTimeHours}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t.planningReports.execHours}</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="section-health">
                  {[
                    { 
                      label: t.planningReports.execExpiringRequests, 
                      value: execData.health.expiringSoon, 
                      desc: t.planningReports.execExpiringDesc,
                      tooltip: t.planningReports.kpiTooltips?.expiringSoon || { title: "", definition: "", calculation: "", importance: "", risk: "" }
                    },
                    { 
                      label: t.planningReports.execExpired, 
                      value: execData.health.expiredReservations, 
                      desc: "",
                      tooltip: t.planningReports.kpiTooltips?.expiredReservations || { title: "", definition: "", calculation: "", importance: "", risk: "" }
                    },
                    { 
                      label: t.planningReports.execHighRisk, 
                      value: execData.health.highRiskReservations, 
                      desc: ">70%",
                      tooltip: t.planningReports.kpiTooltips?.highRiskReservations || { title: "", definition: "", calculation: "", importance: "", risk: "" }
                    },
                  ].map((h, i) => {
                    const color = h.value === 0 ? "text-emerald-600 dark:text-emerald-400" : h.value <= 2 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
                    const bg = h.value === 0 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" : h.value <= 2 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
                    return (
                      <Card key={i} className={`border ${bg}`} data-testid={`card-health-${i}`}>
                        <CardContent className="p-4 flex items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1">
                              <p className="text-xs text-muted-foreground">{h.label}</p>
                              <KPITooltip 
                                title={h.tooltip.title}
                                definition={h.tooltip.definition}
                                calculation={h.tooltip.calculation}
                                importance={h.tooltip.importance}
                                riskNote={h.tooltip.risk}
                              />
                            </div>
                            <p className={`text-2xl font-bold ${color}`}>
                              {h.value === 0 ? t.planningReports.execHealthy : h.value}
                            </p>
                            {h.desc && <p className="text-[10px] text-muted-foreground">{h.desc}</p>}
                          </div>
                          <AlertTriangle className={`w-5 h-5 ${color} flex-shrink-0`} />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="section-exec-charts">
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{t.planningReports.execReservedVsReleased}</span>
                        <span className="text-[10px] text-muted-foreground">{t.planningReports.execLast30}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={execData.trendData} margin={{ left: 10, right: 10, top: 10, bottom: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                          <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} className="text-xs" reversed={isRTL} tick={{ fontSize: 10 }} />
                          <YAxis className="text-xs" orientation={isRTL ? "right" : "left"} tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                          <Tooltip contentStyle={{ direction: isRTL ? "rtl" : "ltr", fontSize: 12 }} formatter={(v: number) => [v.toLocaleString(), ""]} />
                          <Line type="monotone" dataKey="reserved" stroke="#3b82f6" strokeWidth={2} dot={false} name={t.planningReports.execReserved} />
                          <Line type="monotone" dataKey="released" stroke="#10b981" strokeWidth={2} dot={false} name={t.planningReports.execReleased} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <span className="text-sm font-semibold">{t.planningReports.execReservedByBranch}</span>
                    </CardHeader>
                    <CardContent>
                      {execData.reservedByBranch.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={execData.reservedByBranch} layout="vertical" margin={isRTL ? { left: 20, right: 80, top: 10, bottom: 10 } : { left: 80, right: 20, top: 10, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} reversed={isRTL} />
                            <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} orientation={isRTL ? "right" : "left"} />
                            <Tooltip contentStyle={{ direction: isRTL ? "rtl" : "ltr", fontSize: 12 }} formatter={(v: number) => [`${v.toLocaleString()} ${t.planningReports.execSar}`, ""]} />
                            <Bar dataKey="value" fill="hsl(var(--primary))" radius={isRTL ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {execData.alertItems.length > 0 && (
                  <Card data-testid="card-exec-alerts">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-destructive" />
                        <span className="text-sm font-semibold">{t.planningReports.execAlertsTable}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.execAlertReqNo}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.execAlertBranch}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.execAlertValue}</TableHead>
                              <TableHead>{t.planningReports.execAlertExpiry}</TableHead>
                              <TableHead className={isRTL ? "text-right" : "text-left"}>{t.planningReports.execAlertRisk}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {execData.alertItems.map((item, i) => (
                              <TableRow key={i} data-testid={`row-exec-alert-${i}`}>
                                <TableCell>
                                  <Link href={`/requests/${item.requestId}`}>
                                    <span className="text-primary cursor-pointer hover:underline font-mono text-xs">{item.requestNumber}</span>
                                  </Link>
                                </TableCell>
                                <TableCell>{item.branch}</TableCell>
                                <TableCell className={`${isRTL ? "text-right" : "text-left"} tabular-nums`}>{item.reservedValue.toLocaleString()} {t.planningReports.execSar}</TableCell>
                                <TableCell className="tabular-nums">{item.expiryDate}</TableCell>
                                <TableCell>
                                  <Badge variant={item.riskLevel === "expired" ? "destructive" : item.riskLevel === "high" ? "secondary" : "outline"}>
                                    {item.riskLevel === "expired" ? t.planningReports.execRiskExpired : item.riskLevel === "high" ? t.planningReports.execRiskHigh : t.planningReports.execRiskLow}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="inventory">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">{t.planningReports.inventoryRisk}</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = `/api/reports/inventory-risk/export`;
                  a.download = "Risk_Console.xlsx";
                  fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
                    .then(r => r.blob())
                    .then(b => { a.href = URL.createObjectURL(b); a.click(); });
                }}
                data-testid="button-ir-export"
              >
                <Download className="w-4 h-4" />
                <span className={isRTL ? "mr-1" : "ml-1"}>{t.planningReports.irExport}</span>
              </Button>
            </div>

            <Card data-testid="card-ir-filters">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irBranch || "منفذ البيع"}</label>
                    <Select value={irBranch || "all"} onValueChange={(v) => setIrBranch(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-ir-branch">
                        <SelectValue placeholder={t.planningReports.irAllBranches} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.irAllBranches}</SelectItem>
                        {irData?.filters?.branches.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irDepartment || "قناة البيع"}</label>
                    <Select value={irWarehouse || "all"} onValueChange={(v) => setIrWarehouse(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-ir-warehouse">
                        <SelectValue placeholder={t.planningReports.irAllWarehouses} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.irAllWarehouses}</SelectItem>
                        {irData?.filters?.warehouses.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irCategory || "الفئة"}</label>
                    <Select value={irCategory || "all"} onValueChange={(v) => setIrCategory(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-ir-category">
                        <SelectValue placeholder={t.planningReports.irAllCategories} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.irAllCategories}</SelectItem>
                        {irData?.filters?.categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-[130px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irRiskFilter || "مستوى المخاطر"}</label>
                    <Select value={irRiskFilter || "all"} onValueChange={(v) => setIrRiskFilter(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-ir-risk">
                        <SelectValue placeholder={t.planningReports.irAllLevels} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.irAllLevels}</SelectItem>
                        <SelectItem value="High">{t.planningReports.irRiskHigh}</SelectItem>
                        <SelectItem value="Medium">{t.planningReports.irRiskMedium}</SelectItem>
                        <SelectItem value="Low">{t.planningReports.irRiskLow}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-[130px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irHighestReservationRatio || "أعلى نسبة حجز"}</label>
                    <Input
                      type="number"
                      placeholder={t.planningReports.irMinRatio}
                      value={irMinRatio}
                      onChange={(e) => setIrMinRatio(e.target.value)}
                      data-testid="input-ir-min-ratio"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 justify-end">
                    <label className="flex items-center gap-2 cursor-pointer select-none py-2">
                      <input
                        type="checkbox"
                        checked={irExpiredOnly}
                        onChange={(e) => setIrExpiredOnly(e.target.checked)}
                        className="rounded border-border"
                        data-testid="checkbox-ir-expired-only"
                      />
                      <span className="text-[13px] font-semibold text-[#6b7280] whitespace-nowrap">{t.planningReports.irExpiredOnly || "المنتهية فقط"}</span>
                    </label>
                  </div>

                  <div className="flex items-end pb-1.5">
                    {(irBranch || irWarehouse || irCategory || irRiskFilter || irMinRatio || irExpiredOnly) && (
                      <Button variant="ghost" size="icon" onClick={() => { setIrBranch(""); setIrWarehouse(""); setIrCategory(""); setIrRiskFilter(""); setIrMinRatio(""); setIrExpiredOnly(false); }} data-testid="button-ir-clear-filters">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {irLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-md" />)
              ) : irData ? (
                <>
                  <Card data-testid="kpi-ir-high-risk">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.irHighRiskItems}</p>
                            <KPITooltip 
                              title={t.planningReports.irHighRiskItems}
                              definition={t.planningReports.irHighRiskItemsDef}
                              calculation={t.planningReports.irHighRiskItemsCalc}
                              importance={t.planningReports.irHighRiskItemsImp}
                              riskNote={t.planningReports.irHighRiskItemsRisk}
                            />
                          </div>
                      </div>
                      <p className="text-3xl font-bold tracking-tight text-red-600 dark:text-red-400">{irData.kpis.highRiskItems}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-ir-expired">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.irExpiredReservations}</p>
                            <KPITooltip 
                              title={t.planningReports.irExpiredReservations}
                              definition={t.planningReports.kpiTooltips?.expiredReservations?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.expiredReservations?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.expiredReservations?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.expiredReservations?.risk || ""}
                            />
                          </div>
                      </div>
                      <p className="text-3xl font-bold tracking-tight text-orange-600 dark:text-orange-400">{irData.kpis.expiredReservations}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-ir-expiring">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.irExpiringSoon}</p>
                            <KPITooltip 
                              title={t.planningReports.irExpiringSoon}
                              definition={t.planningReports.kpiTooltips?.expiringSoon?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.expiringSoon?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.expiringSoon?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.expiringSoon?.risk || ""}
                            />
                          </div>
                      </div>
                      <p className="text-3xl font-bold tracking-tight text-amber-600 dark:text-amber-400">{irData.kpis.expiringSoon}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-ir-low-stock">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.irLowStockAlerts}</p>
                            <KPITooltip 
                              title={t.planningReports.irLowStockAlerts}
                              definition={t.planningReports.irLowStockAlertsDef}
                              calculation={t.planningReports.irLowStockAlertsCalc}
                              importance={t.planningReports.irLowStockAlertsImp}
                              riskNote={t.planningReports.irLowStockAlertsRisk}
                            />
                          </div>
                      </div>
                      <p className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{irData.kpis.lowStockAlerts}</p>
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </div>

            <Card data-testid="table-ir-products">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="p-3 text-start font-medium">{t.planningReports.irProductCode}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.irDescription}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.irReservedQty}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.irAvailableQty}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.irReservedRatio}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.irDaysToExpiry}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.irRiskScore}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.irRiskLevel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {irLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="border-b">
                            {Array.from({ length: 8 }).map((_, j) => (
                              <td key={j} className="p-3"><Skeleton className="h-4 w-16" /></td>
                            ))}
                          </tr>
                        ))
                      ) : irPagedProducts.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">{t.planningReports.noData}</td>
                        </tr>
                      ) : irPagedProducts.map((p, i) => (
                        <tr key={p.code} className="border-b" data-testid={`row-ir-product-${i}`}>
                          <td className="p-3 font-mono text-xs">{p.code}</td>
                          <td className="p-3 max-w-[200px] truncate">{p.desc}</td>
                          <td className="p-3 font-medium">{p.reserved.toLocaleString()}</td>
                          <td className="p-3">{p.available.toLocaleString()}</td>
                          <td className="p-3">
                            <span className={`font-semibold ${p.reservedRatio > 100 ? "text-red-600 dark:text-red-400" : p.reservedRatio > 70 ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {p.reservedRatio}%
                            </span>
                          </td>
                          <td className="p-3">
                            {p.daysToExpiry !== null ? (
                              <span className={p.daysToExpiry < 0 ? "text-red-600 dark:text-red-400 font-semibold" : p.daysToExpiry <= 3 ? "text-orange-600 dark:text-orange-400 font-semibold" : ""}>
                                {p.daysToExpiry}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={`font-bold ${p.riskScore >= 50 ? "text-red-600 dark:text-red-400" : p.riskScore >= 30 ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {p.riskScore}
                            </span>
                          </td>
                          <td className="p-3">
                            <Badge variant={p.riskLevel === "High" ? "destructive" : p.riskLevel === "Medium" ? "secondary" : "outline"}>
                              {p.riskLevel === "High" ? t.planningReports.irRiskHigh : p.riskLevel === "Medium" ? t.planningReports.irRiskMedium : t.planningReports.irRiskLow}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {irTotalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 p-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      {t.planningReports.irPage} {irPage} {t.planningReports.irOf} {irTotalPages} ({irFilteredProducts.length})
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" disabled={irPage <= 1} onClick={() => setIrPage(p => p - 1)} data-testid="button-ir-prev">
                        {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" size="icon" disabled={irPage >= irTotalPages} onClick={() => setIrPage(p => p + 1)} data-testid="button-ir-next">
                        {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {irData && irData.products.length > 0 && (
              <Card data-testid="chart-ir-top-risk">
                <CardHeader className="pb-2">
                  <span className="text-sm font-semibold">{t.planningReports.irTopRiskProducts}</span>
                </CardHeader>
                <CardContent>
                  <div style={{ height: 280 }}>
                    <ChartBar
                      data={{
                        labels: irData.products.slice(0, 10).map(p => p.code),
                        datasets: [{
                          label: t.planningReports.irRiskScore,
                          data: irData.products.slice(0, 10).map(p => p.riskScore),
                          backgroundColor: irData.products.slice(0, 10).map(p =>
                            p.riskScore >= 50 ? "#ef4444" : p.riskScore >= 30 ? "#f97316" : "#10b981"
                          ),
                          borderRadius: 4,
                        }],
                      }}
                      options={{
                        indexAxis: "y" as const,
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            rtl: isRTL,
                            callbacks: {
                              label: (ctx: any) => `${t.planningReports.irRiskScore}: ${ctx.formattedValue}/100`,
                            },
                          },
                        },
                        scales: {
                          x: {
                            position: isRTL ? "top" : "bottom",
                            max: 100,
                            ticks: { stepSize: 20 },
                          },
                          y: {
                            position: isRTL ? "right" : "left",
                          },
                        },
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="performance">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">{t.planningReports.perfTitle}</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const qp = new URLSearchParams();
                  if (perfBranch) qp.set("branch", perfBranch);
                  if (perfDateFrom) qp.set("dateFrom", perfDateFrom);
                  if (perfDateTo) qp.set("dateTo", perfDateTo);
                  if (perfRepId) qp.set("salesRepId", perfRepId);
                  const url = `/api/reports/performance/export${qp.toString() ? `?${qp}` : ""}`;
                  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                    .then(r => r.blob())
                    .then(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "Sales_Performance.xlsx"; a.click(); });
                }}
                data-testid="button-perf-export"
              >
                <Download className="w-4 h-4" />
                <span className={isRTL ? "mr-1" : "ml-1"}>{t.planningReports.perfExport}</span>
              </Button>
            </div>

            <Card data-testid="card-perf-filters">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irBranch || "منفذ البيع"}</label>
                    <Select value={perfBranch || "all"} onValueChange={(v) => setPerfBranch(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-perf-branch">
                        <SelectValue placeholder={t.planningReports.perfAllBranches} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.perfAllBranches}</SelectItem>
                        {(perfData?.filters?.branches || []).map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irDateFrom || "التاريخ من"}</label>
                    <Input type="date" value={perfDateFrom} onChange={(e) => setPerfDateFrom(e.target.value)} className="w-full" data-testid="input-perf-date-from" />
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irDateTo || "التاريخ إلى"}</label>
                    <Input type="date" value={perfDateTo} onChange={(e) => setPerfDateTo(e.target.value)} className="w-full" data-testid="input-perf-date-to" />
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-[160px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.irSalesRep || "المندوب"}</label>
                    <Select value={perfRepId || "all"} onValueChange={(v) => setPerfRepId(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-perf-rep">
                        <SelectValue placeholder={t.planningReports.perfAllReps} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.perfAllReps}</SelectItem>
                        {(perfData?.filters?.salesReps || []).map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5 justify-end">
                    <label className="flex items-center gap-2 cursor-pointer select-none py-2">
                      <input type="checkbox" checked={perfActiveOnly} onChange={(e) => setPerfActiveOnly(e.target.checked)} className="rounded border-border" data-testid="checkbox-perf-active-only" />
                      <span className="text-[13px] font-semibold text-[#6b7280] whitespace-nowrap">{t.planningReports.irActiveOnly || "عرض النشطين فقط"}</span>
                    </label>
                  </div>

                  <div className="flex items-end pb-1.5">
                    {(perfBranch || perfDateFrom || perfDateTo || perfRepId || perfActiveOnly) && (
                      <Button variant="ghost" size="icon" onClick={() => { setPerfBranch(""); setPerfDateFrom(""); setPerfDateTo(""); setPerfRepId(""); setPerfActiveOnly(false); }} data-testid="button-perf-clear-filters">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {perfLoading ? (
                Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-md" />)
              ) : perfData ? (
                <>
                  <Card data-testid="kpi-perf-actual-revenue">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.perfActualRevenue || 'Actual Revenue'}</p>
                            <KPITooltip 
                              title={t.planningReports.perfActualRevenue || 'Actual Revenue'}
                              definition={t.planningReports.kpiTooltips?.totalReleasedValue?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.totalReleasedValue?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.totalReleasedValue?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.totalReleasedValue?.risk || ""}
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-2xl font-bold tracking-tight">{perfData.kpis.actualRevenue.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-perf-expected-revenue">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.perfExpectedRevenue || 'Expected Revenue'}</p>
                            <KPITooltip 
                              title={t.planningReports.perfExpectedRevenue || 'Expected Revenue'}
                              definition={t.planningReports.kpiTooltips?.expectedProfit?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.expectedProfit?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.expectedProfit?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.expectedProfit?.risk || ""}
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-2xl font-bold tracking-tight">{perfData.kpis.expectedRevenue.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-perf-approval-time">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.perfAvgApprovalTime || 'Avg Approval Time'}</p>
                            <KPITooltip 
                              title={t.planningReports.perfAvgApprovalTime || 'Avg Approval Time'}
                              definition={t.planningReports.kpiTooltips?.avgApprovalTime?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.avgApprovalTime?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.avgApprovalTime?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.avgApprovalTime?.risk || ""}
                            />
                          </div>
                        </div>
                      </div>
                      <p className={`text-2xl font-bold tracking-tight ${perfData.kpis.avgApprovalTimeHours > 24 ? "text-orange-600 dark:text-orange-400" : ""}`}>{perfData.kpis.avgApprovalTimeHours} {t.planningReports.perfHours}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-perf-rejection-rate">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingDown className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.perfRejectionRate || 'Rejection Rate'}</p>
                            <KPITooltip 
                              title={t.planningReports.perfRejectionRate || 'Rejection Rate'}
                              definition={t.planningReports.kpiTooltips?.conversionRate?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.conversionRate?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.conversionRate?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.conversionRate?.risk || ""}
                            />
                          </div>
                        </div>
                      </div>
                      <p className={`text-2xl font-bold tracking-tight ${perfData.kpis.rejectionRate > 20 ? "text-red-600 dark:text-red-400" : ""}`}>{perfData.kpis.rejectionRate}%</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-perf-profit-margin">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Percent className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.perfProfitMargin || 'Profit Margin %'}</p>
                            <KPITooltip 
                              title={t.planningReports.perfProfitMargin || 'Profit Margin %'}
                              definition={t.planningReports.kpiTooltips?.avgMargin?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.avgMargin?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.avgMargin?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.avgMargin?.risk || ""}
                            />
                          </div>
                        </div>
                      </div>
                      <p className={`text-2xl font-bold tracking-tight ${perfData.kpis.profitMargin > 15 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{perfData.kpis.profitMargin}%</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-perf-conversion-rate">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <div className="flex items-center gap-1">
                            <p className="text-xs text-muted-foreground font-medium">{t.planningReports.perfConversionRate || 'Conversion Rate'}</p>
                            <KPITooltip 
                              title={t.planningReports.perfConversionRate || 'Conversion Rate'}
                              definition={t.planningReports.kpiTooltips?.conversionRate?.definition || ""}
                              calculation={t.planningReports.kpiTooltips?.conversionRate?.calculation || ""}
                              importance={t.planningReports.kpiTooltips?.conversionRate?.importance || ""}
                              riskNote={t.planningReports.kpiTooltips?.conversionRate?.risk || ""}
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-2xl font-bold tracking-tight">{perfData.kpis.conversionRate}%</p>
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </div>

            {perfData && perfData.insights && (
              <Card data-testid="card-perf-insights">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold mb-3">{t.planningReports.perfInsights}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {perfData.insights.topPerformer && (
                      <div className="flex items-center gap-3 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30">
                        <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t.planningReports.perfTopPerformer}</p>
                          <p className="text-sm font-semibold">{perfData.insights.topPerformer.name}</p>
                          <p className="text-xs text-muted-foreground">{perfData.insights.topPerformer.actualProfit.toLocaleString()} {t.planningReports.feSar}</p>
                        </div>
                      </div>
                    )}
                    {perfData.insights.slowestApprover && (
                      <div className="flex items-center gap-3 p-3 rounded-md bg-orange-50 dark:bg-orange-950/30">
                        <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t.planningReports.perfSlowestApprover}</p>
                          <p className="text-sm font-semibold">{perfData.insights.slowestApprover.name}</p>
                          <p className="text-xs text-muted-foreground">{perfData.insights.slowestApprover.avgHours} {t.planningReports.perfHours}</p>
                        </div>
                      </div>
                    )}
                    {perfData.insights.highestRejRisk && (
                      <div className="flex items-center gap-3 p-3 rounded-md bg-red-50 dark:bg-red-950/30">
                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t.planningReports.perfHighestRejRisk}</p>
                          <p className="text-sm font-semibold">{perfData.insights.highestRejRisk.name}</p>
                          <p className="text-xs text-muted-foreground">{perfData.insights.highestRejRisk.rate}%</p>
                        </div>
                      </div>
                    )}
                    {perfData.insights.mostProfitable && (
                      <div className="flex items-center gap-3 p-3 rounded-md bg-blue-50 dark:bg-blue-950/30">
                        <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t.planningReports.perfMostProfitable}</p>
                          <p className="text-sm font-semibold">{perfData.insights.mostProfitable.name}</p>
                          <p className="text-xs text-muted-foreground">{perfData.insights.mostProfitable.margin}%</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card data-testid="card-perf-ranking-table">
              <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
                <span className="text-sm font-semibold">{t.planningReports.perfRepRanking}</span>
                <KPITooltip 
                  title={t.planningReports.perfRepRanking}
                  definition={t.planningReports.kpiTooltips.piProfitByRepTooltip?.definition || ""}
                  calculation=""
                  importance={t.planningReports.kpiTooltips.piProfitByRepTooltip?.importance || ""}
                  riskNote=""
                />
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="p-3 text-start font-medium">{t.planningReports.perfRank}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfRepName}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfTotalOrders}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfApprovedOrders}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfRejectedOrders}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfApprovalTimeAvg}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfExpectedProfit}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfActualProfit}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfMarginCol}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.perfConvCol}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="border-b">
                            {Array.from({ length: 10 }).map((_, j) => (
                              <td key={j} className="p-3"><Skeleton className="h-4 w-14" /></td>
                            ))}
                          </tr>
                        ))
                      ) : perfPagedRanking.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-8 text-center text-muted-foreground">{t.planningReports.noData}</td>
                        </tr>
                      ) : perfPagedRanking.map((rep, i) => (
                        <tr key={rep.id} className="border-b" data-testid={`row-perf-rep-${i}`}>
                          <td className="p-3 font-bold text-muted-foreground">{rep.rank}</td>
                          <td className="p-3 font-medium">{rep.name}</td>
                          <td className="p-3">{rep.totalOrders}</td>
                          <td className="p-3 text-emerald-600 dark:text-emerald-400">{rep.approvedOrders}</td>
                          <td className="p-3">
                            {rep.rejectedOrders > 0 ? (
                              <span className="text-red-600 dark:text-red-400">{rep.rejectedOrders}</span>
                            ) : (
                              <span>{rep.rejectedOrders}</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={rep.avgApprovalHours > 24 ? "text-orange-600 dark:text-orange-400 font-semibold" : ""}>
                              {rep.avgApprovalHours} {t.planningReports.perfHours}
                            </span>
                          </td>
                          <td className="p-3">{rep.expectedProfit.toLocaleString()}</td>
                          <td className="p-3 font-semibold">{rep.actualProfit.toLocaleString()}</td>
                          <td className="p-3">
                            <Badge variant={rep.profitMargin > 20 ? "default" : rep.profitMargin > 10 ? "secondary" : "destructive"}>
                              {rep.profitMargin}%
                            </Badge>
                          </td>
                          <td className="p-3">{rep.conversionRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {perfTotalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 p-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      {t.planningReports.perfPage} {perfPage} {t.planningReports.perfOf} {perfTotalPages} ({perfData?.repRanking?.length || 0})
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" disabled={perfPage <= 1} onClick={() => setPerfPage(p => p - 1)} data-testid="button-perf-prev">
                        {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" size="icon" disabled={perfPage >= perfTotalPages} onClick={() => setPerfPage(p => p + 1)} data-testid="button-perf-next">
                        {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {perfData && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card data-testid="card-perf-chart-profit">
                  <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
                    <span className="text-sm font-semibold">{t.planningReports.perfProfitByRep}</span>
                    <KPITooltip 
                      title={t.planningReports.perfProfitByRep}
                      definition={t.planningReports.kpiTooltips.piProfitByRepTooltip.definition}
                      calculation=""
                      importance={t.planningReports.kpiTooltips.piProfitByRepTooltip.importance}
                      riskNote=""
                    />
                  </CardHeader>
                  <CardContent className="p-4">
                    {perfData.repRanking.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={perfData.repRanking.slice(0, 8)} layout="vertical" margin={isRTL ? { left: 20, right: 80, top: 5, bottom: 5 } : { left: 80, right: 20, top: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" reversed={isRTL} />
                          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 10 }} orientation={isRTL ? "right" : "left"} />
                          <Tooltip formatter={(v: number) => [v.toLocaleString(), t.planningReports.perfActualProfit]} contentStyle={{ direction: isRTL ? "rtl" : "ltr" }} />
                          <Bar dataKey="actualProfit" fill="hsl(var(--primary))" radius={isRTL ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                    )}
                  </CardContent>
                </Card>

                <Card data-testid="card-perf-chart-trend">
                  <CardHeader className="pb-2">
                    <span className="text-sm font-semibold">{t.planningReports.perfApprovalTrend}</span>
                  </CardHeader>
                  <CardContent className="p-4">
                    {perfData.approvalTrend.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={perfData.approvalTrend} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} reversed={isRTL} />
                          <YAxis tick={{ fontSize: 10 }} orientation={isRTL ? "right" : "left"} />
                          <Tooltip formatter={(v: number) => [`${v} ${t.planningReports.perfHours}`, t.planningReports.perfAvgApprovalTime]} contentStyle={{ direction: isRTL ? "rtl" : "ltr" }} />
                          <Line type="monotone" dataKey="avgHours" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                    )}
                  </CardContent>
                </Card>

                <Card data-testid="card-perf-chart-pie">
                  <CardHeader className="pb-2">
                    <span className="text-sm font-semibold">{t.planningReports.perfStatusSplit}</span>
                  </CardHeader>
                  <CardContent className="p-4">
                    {(perfData.statusSplit.approved + perfData.statusSplit.rejected + perfData.statusSplit.pending) > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: t.planningReports.perfApproved, value: perfData.statusSplit.approved },
                              { name: t.planningReports.perfRejected, value: perfData.statusSplit.rejected },
                              { name: t.planningReports.perfPending, value: perfData.statusSplit.pending },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            <Cell fill="#10b981" />
                            <Cell fill="#ef4444" />
                            <Cell fill="#f59e0b" />
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="product">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">{t.planningReports.ppTitle}</h2>
            </div>

            <Card data-testid="card-pp-filters">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.ppCategory}</label>
                    <Select value={ppCategory || "all"} onValueChange={(v) => setPpCategory(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-pp-category">
                        <SelectValue placeholder={t.planningReports.ppAllCategories} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.ppAllCategories}</SelectItem>
                        {(ppData?.filters?.categories || []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.ppBrand}</label>
                    <Select value={ppBrand || "all"} onValueChange={(v) => setPpBrand(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-pp-brand">
                        <SelectValue placeholder={t.planningReports.ppAllBrands} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.ppAllBrands}</SelectItem>
                        {(ppData?.filters?.brands || []).map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.ppWarehouse}</label>
                    <Select value={ppWarehouse || "all"} onValueChange={(v) => setPpWarehouse(v === "all" ? "" : v)}>
                      <SelectTrigger data-testid="select-pp-warehouse">
                        <SelectValue placeholder={t.planningReports.ppAllWarehouses} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.planningReports.ppAllWarehouses}</SelectItem>
                        {(ppData?.filters?.warehouses || []).map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.ppDateFrom}</label>
                    <Input type="date" value={ppDateFrom} onChange={(e) => setPpDateFrom(e.target.value)} className="w-full" data-testid="input-pp-date-from" />
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-[150px]">
                    <label className="text-[13px] font-semibold text-[#6b7280]">{t.planningReports.ppDateTo}</label>
                    <Input type="date" value={ppDateTo} onChange={(e) => setPpDateTo(e.target.value)} className="w-full" data-testid="input-pp-date-to" />
                  </div>
                  <div className="flex items-end pb-1.5">
                    {(ppCategory || ppBrand || ppWarehouse || ppDateFrom || ppDateTo) && (
                      <Button variant="ghost" size="icon" onClick={() => { setPpCategory(""); setPpBrand(""); setPpWarehouse(""); setPpDateFrom(""); setPpDateTo(""); }} data-testid="button-pp-clear-filters">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4" data-testid="section-pp-kpis">
              {ppLoading ? (
                Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-md" />)
              ) : ppData ? (
                <>
                  <Card data-testid="kpi-pp-total-products">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground font-medium">{t.planningReports.ppTotalProducts}</p>
                          <KPITooltip
                            title={t.planningReports.kpiTooltips.ppTotalProducts.title}
                            definition={t.planningReports.kpiTooltips.ppTotalProducts.definition}
                            calculation={t.planningReports.kpiTooltips.ppTotalProducts.calculation}
                            importance={t.planningReports.kpiTooltips.ppTotalProducts.importance}
                            riskNote={t.planningReports.kpiTooltips.ppTotalProducts.risk}
                          />
                        </div>
                      </div>
                      <p className="text-2xl font-bold tracking-tight">{ppData.kpis.totalProducts.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-pp-inventory-value">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground font-medium">{t.planningReports.ppTotalInventoryValue}</p>
                          <KPITooltip
                            title={t.planningReports.kpiTooltips.ppTotalInventoryValue.title}
                            definition={t.planningReports.kpiTooltips.ppTotalInventoryValue.definition}
                            calculation={t.planningReports.kpiTooltips.ppTotalInventoryValue.calculation}
                            importance={t.planningReports.kpiTooltips.ppTotalInventoryValue.importance}
                            riskNote={t.planningReports.kpiTooltips.ppTotalInventoryValue.risk}
                          />
                        </div>
                      </div>
                      <p className="text-2xl font-bold tracking-tight">{ppData.kpis.totalInventoryValue.toLocaleString()} {t.planningReports.feSar}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-pp-potential-sales">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground font-medium">{t.planningReports.ppPotentialSalesValue}</p>
                          <KPITooltip
                            title={t.planningReports.kpiTooltips.ppPotentialSalesValue.title}
                            definition={t.planningReports.kpiTooltips.ppPotentialSalesValue.definition}
                            calculation={t.planningReports.kpiTooltips.ppPotentialSalesValue.calculation}
                            importance={t.planningReports.kpiTooltips.ppPotentialSalesValue.importance}
                            riskNote={t.planningReports.kpiTooltips.ppPotentialSalesValue.risk}
                          />
                        </div>
                      </div>
                      <p className="text-2xl font-bold tracking-tight">{ppData.kpis.totalPotentialSalesValue.toLocaleString()} {t.planningReports.feSar}</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-pp-top-profit">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Award className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground font-medium">{t.planningReports.ppTopProfitProduct}</p>
                          <KPITooltip
                            title={t.planningReports.kpiTooltips.ppTopProfitProduct.title}
                            definition={t.planningReports.kpiTooltips.ppTopProfitProduct.definition}
                            calculation={t.planningReports.kpiTooltips.ppTopProfitProduct.calculation}
                            importance={t.planningReports.kpiTooltips.ppTopProfitProduct.importance}
                            riskNote={t.planningReports.kpiTooltips.ppTopProfitProduct.risk}
                          />
                        </div>
                      </div>
                      {ppData.kpis.topProfitProduct ? (
                        <>
                          <p className="text-sm font-bold tracking-tight truncate">{ppData.kpis.topProfitProduct.description}</p>
                          <p className="text-xs text-muted-foreground">{ppData.kpis.topProfitProduct.profit.toLocaleString()} {t.planningReports.feSar}</p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">-</p>
                      )}
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-pp-avg-margin">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Percent className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground font-medium">{t.planningReports.ppAvgMargin}</p>
                          <KPITooltip
                            title={t.planningReports.kpiTooltips.ppAvgMargin.title}
                            definition={t.planningReports.kpiTooltips.ppAvgMargin.definition}
                            calculation={t.planningReports.kpiTooltips.ppAvgMargin.calculation}
                            importance={t.planningReports.kpiTooltips.ppAvgMargin.importance}
                            riskNote={t.planningReports.kpiTooltips.ppAvgMargin.risk}
                          />
                        </div>
                      </div>
                      <p className={`text-2xl font-bold tracking-tight ${ppData.kpis.avgMargin > 15 ? "text-emerald-600 dark:text-emerald-400" : ppData.kpis.avgMargin < 5 ? "text-red-600 dark:text-red-400" : ""}`}>{ppData.kpis.avgMargin}%</p>
                    </CardContent>
                  </Card>
                  <Card data-testid="kpi-pp-frozen-capital">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Snowflake className="w-4 h-4 text-muted-foreground" />
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-muted-foreground font-medium">{t.planningReports.ppFrozenCapital}</p>
                          <KPITooltip
                            title={t.planningReports.kpiTooltips.ppFrozenCapital.title}
                            definition={t.planningReports.kpiTooltips.ppFrozenCapital.definition}
                            calculation={t.planningReports.kpiTooltips.ppFrozenCapital.calculation}
                            importance={t.planningReports.kpiTooltips.ppFrozenCapital.importance}
                            riskNote={t.planningReports.kpiTooltips.ppFrozenCapital.risk}
                          />
                        </div>
                      </div>
                      <p className={`text-2xl font-bold tracking-tight ${ppData.kpis.frozenCapitalValue > 0 ? "text-orange-600 dark:text-orange-400" : ""}`}>{ppData.kpis.frozenCapitalValue.toLocaleString()} {t.planningReports.feSar}</p>
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </div>

            {ppData && ppData.insights && (
              <Card data-testid="card-pp-insights">
                <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
                  <span className="text-sm font-semibold">{t.planningReports.ppInsights}</span>
                  <KPITooltip
                    title={t.planningReports.kpiTooltips.ppInsightsTooltip.title}
                    definition={t.planningReports.kpiTooltips.ppInsightsTooltip.definition}
                    calculation={t.planningReports.kpiTooltips.ppInsightsTooltip.calculation}
                    importance={t.planningReports.kpiTooltips.ppInsightsTooltip.importance}
                    riskNote={t.planningReports.kpiTooltips.ppInsightsTooltip.risk}
                  />
                </CardHeader>
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex items-start gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30">
                      <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">{t.planningReports.ppSlowMoving}</p>
                        <p className="text-sm font-semibold">{ppData.insights.slowMovingCount} {t.planningReports.ppProducts}</p>
                        <p className="text-xs text-muted-foreground">{t.planningReports.ppValue}: {ppData.insights.slowMovingValue.toLocaleString()} {t.planningReports.feSar}</p>
                        <p className="text-[10px] text-muted-foreground mt-1 italic">{t.planningReports.ppSlowMovingDesc}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-md bg-red-50 dark:bg-red-950/30">
                      <Flame className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">{t.planningReports.ppHighDemand}</p>
                        <p className="text-sm font-semibold">{ppData.insights.highDemandCount} {t.planningReports.ppProducts}</p>
                        {ppData.insights.topHighDemand.map((p, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground">{p.code}: {t.planningReports.ppGap} {p.gap}</p>
                        ))}
                        <p className="text-[10px] text-muted-foreground mt-1 italic">{t.planningReports.ppHighDemandDesc}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30">
                      <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">{t.planningReports.ppHighMargin}</p>
                        <p className="text-sm font-semibold">{ppData.insights.highMarginCount} {t.planningReports.ppProducts}</p>
                        {ppData.insights.topHighMargin.map((p, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground">{p.code}: {p.margin}%</p>
                        ))}
                        <p className="text-[10px] text-muted-foreground mt-1 italic">{t.planningReports.ppHighMarginDesc}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-md bg-blue-50 dark:bg-blue-950/30">
                      <Snowflake className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">{t.planningReports.ppFrozenCapital}</p>
                        <p className="text-sm font-semibold">{ppData.insights.frozenCapitalCount} {t.planningReports.ppProducts}</p>
                        <p className="text-xs text-muted-foreground">{ppData.kpis.frozenCapitalValue.toLocaleString()} {t.planningReports.feSar}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {ppData && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card data-testid="card-pp-chart-revenue">
                  <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
                    <span className="text-sm font-semibold">{t.planningReports.ppTop10Revenue}</span>
                    <KPITooltip
                      title={t.planningReports.kpiTooltips.ppTop10RevenueChart.title}
                      definition={t.planningReports.kpiTooltips.ppTop10RevenueChart.definition}
                      calculation={t.planningReports.kpiTooltips.ppTop10RevenueChart.calculation}
                      importance={t.planningReports.kpiTooltips.ppTop10RevenueChart.importance}
                      riskNote={t.planningReports.kpiTooltips.ppTop10RevenueChart.risk}
                    />
                  </CardHeader>
                  <CardContent className="p-4">
                    {ppData.charts.top10Revenue.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={ppData.charts.top10Revenue} layout="vertical" margin={isRTL ? { left: 20, right: 80, top: 5, bottom: 5 } : { left: 80, right: 20, top: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" reversed={isRTL} />
                          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 9 }} orientation={isRTL ? "right" : "left"} />
                          <Tooltip formatter={(v: number) => [v.toLocaleString(), t.planningReports.ppRevenue]} contentStyle={{ direction: isRTL ? "rtl" : "ltr" }} />
                          <Bar dataKey="revenue" fill="#3b82f6" radius={isRTL ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                    )}
                  </CardContent>
                </Card>

                <Card data-testid="card-pp-chart-profit">
                  <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
                    <span className="text-sm font-semibold">{t.planningReports.ppTop10Profit}</span>
                    <KPITooltip
                      title={t.planningReports.kpiTooltips.ppTop10ProfitChart.title}
                      definition={t.planningReports.kpiTooltips.ppTop10ProfitChart.definition}
                      calculation={t.planningReports.kpiTooltips.ppTop10ProfitChart.calculation}
                      importance={t.planningReports.kpiTooltips.ppTop10ProfitChart.importance}
                      riskNote={t.planningReports.kpiTooltips.ppTop10ProfitChart.risk}
                    />
                  </CardHeader>
                  <CardContent className="p-4">
                    {ppData.charts.top10Profit.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={ppData.charts.top10Profit} layout="vertical" margin={isRTL ? { left: 20, right: 80, top: 5, bottom: 5 } : { left: 80, right: 20, top: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" reversed={isRTL} />
                          <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 9 }} orientation={isRTL ? "right" : "left"} />
                          <Tooltip formatter={(v: number) => [v.toLocaleString(), t.planningReports.ppProfit]} contentStyle={{ direction: isRTL ? "rtl" : "ltr" }} />
                          <Bar dataKey="profit" fill="#10b981" radius={isRTL ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                    )}
                  </CardContent>
                </Card>

                <Card data-testid="card-pp-chart-category">
                  <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
                    <span className="text-sm font-semibold">{t.planningReports.ppCategoryBreakdown}</span>
                    <KPITooltip
                      title={t.planningReports.kpiTooltips.ppCategoryChart.title}
                      definition={t.planningReports.kpiTooltips.ppCategoryChart.definition}
                      calculation={t.planningReports.kpiTooltips.ppCategoryChart.calculation}
                      importance={t.planningReports.kpiTooltips.ppCategoryChart.importance}
                      riskNote={t.planningReports.kpiTooltips.ppCategoryChart.risk}
                    />
                  </CardHeader>
                  <CardContent className="p-4">
                    {ppData.charts.categoryChart.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={ppData.charts.categoryChart}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            dataKey="profit"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {ppData.charts.categoryChart.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => [v.toLocaleString(), t.planningReports.ppProfit]} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">{t.planningReports.noData}</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            <Card data-testid="card-pp-products-table">
              <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
                <span className="text-sm font-semibold">{t.planningReports.ppProductsTable}</span>
                <div className="flex items-center gap-2">
                  <KPITooltip
                    title={t.planningReports.ppProductsTable}
                    definition={t.planningReports.kpiTooltips.ppTotalProfitCol.definition}
                    calculation=""
                    importance={t.planningReports.kpiTooltips.ppTotalProfitCol.importance}
                    riskNote=""
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="p-3 text-start font-medium">{t.planningReports.ppCode}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.ppDescription}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.ppBrand}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.ppAvailable}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.ppRequested}</th>
                        <th className="p-3 text-start font-medium">{t.planningReports.ppReleased}</th>
                        <th className="p-3 text-start font-medium">
                          <div className="flex items-center gap-1">
                            {t.planningReports.ppTotalProfit}
                            <KPITooltip
                              title={t.planningReports.kpiTooltips.ppTotalProfitCol.title}
                              definition={t.planningReports.kpiTooltips.ppTotalProfitCol.definition}
                              calculation={t.planningReports.kpiTooltips.ppTotalProfitCol.calculation}
                              importance={t.planningReports.kpiTooltips.ppTotalProfitCol.importance}
                              riskNote={t.planningReports.kpiTooltips.ppTotalProfitCol.risk}
                            />
                          </div>
                        </th>
                        <th className="p-3 text-start font-medium">
                          <div className="flex items-center gap-1">
                            {t.planningReports.ppMargin}
                          </div>
                        </th>
                        <th className="p-3 text-start font-medium">
                          <div className="flex items-center gap-1">
                            {t.planningReports.ppTurnover}
                            <KPITooltip
                              title={t.planningReports.kpiTooltips.ppTurnoverCol.title}
                              definition={t.planningReports.kpiTooltips.ppTurnoverCol.definition}
                              calculation={t.planningReports.kpiTooltips.ppTurnoverCol.calculation}
                              importance={t.planningReports.kpiTooltips.ppTurnoverCol.importance}
                              riskNote={t.planningReports.kpiTooltips.ppTurnoverCol.risk}
                            />
                          </div>
                        </th>
                        <th className="p-3 text-start font-medium">
                          <div className="flex items-center gap-1">
                            {t.planningReports.ppReservationRatio}
                            <KPITooltip
                              title={t.planningReports.kpiTooltips.ppReservationRatioCol.title}
                              definition={t.planningReports.kpiTooltips.ppReservationRatioCol.definition}
                              calculation={t.planningReports.kpiTooltips.ppReservationRatioCol.calculation}
                              importance={t.planningReports.kpiTooltips.ppReservationRatioCol.importance}
                              riskNote={t.planningReports.kpiTooltips.ppReservationRatioCol.risk}
                            />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ppLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} className="border-b">
                            {Array.from({ length: 10 }).map((_, j) => (
                              <td key={j} className="p-3"><Skeleton className="h-4 w-14" /></td>
                            ))}
                          </tr>
                        ))
                      ) : ppPagedProducts.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-8 text-center text-muted-foreground">{t.planningReports.ppNoProducts}</td>
                        </tr>
                      ) : ppPagedProducts.map((product, i) => (
                        <tr key={product.code} className="border-b" data-testid={`row-pp-product-${i}`}>
                          <td className="p-3 font-mono text-xs">{product.code}</td>
                          <td className="p-3 max-w-[200px] truncate">{product.description}</td>
                          <td className="p-3 text-xs">{product.brand}</td>
                          <td className="p-3">{product.availableQuantity.toLocaleString()}</td>
                          <td className="p-3">{product.totalRequested.toLocaleString()}</td>
                          <td className="p-3 text-emerald-600 dark:text-emerald-400">{product.totalReleased.toLocaleString()}</td>
                          <td className="p-3 font-semibold">{product.totalProfit.toLocaleString()}</td>
                          <td className="p-3">
                            <Badge variant={product.marginPercent > 20 ? "default" : product.marginPercent > 10 ? "secondary" : "destructive"}>
                              {product.marginPercent}%
                            </Badge>
                          </td>
                          <td className="p-3">{product.turnoverRate}</td>
                          <td className="p-3">
                            <span className={product.reservationRatio > 50 ? "text-red-600 dark:text-red-400 font-semibold" : ""}>
                              {product.reservationRatio}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ppTotalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 p-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      {t.planningReports.perfPage} {ppPage} {t.planningReports.perfOf} {ppTotalPages} ({ppData?.products?.length || 0})
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" disabled={ppPage <= 1} onClick={() => setPpPage(p => p - 1)} data-testid="button-pp-prev">
                        {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" size="icon" disabled={ppPage >= ppTotalPages} onClick={() => setPpPage(p => p + 1)} data-testid="button-pp-next">
                        {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
