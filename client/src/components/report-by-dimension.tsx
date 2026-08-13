import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  X, ChevronLeft, ChevronRight, Search,
  DollarSign, ArrowUpDown, Hash, Percent, TrendingUp, Eye,
} from "lucide-react";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

function ColHeader({ label, tip, isRTL, colorClass }: { label: string; tip: string; isRTL: boolean; colorClass?: string }) {
  return (
    <th className={`p-3 font-medium ${colorClass ?? ""} ${isRTL ? "text-right" : "text-left"}`}>
      <TooltipProvider delayDuration={150}>
        <UITooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 cursor-help">
              {label}
              <Info className="h-3 w-3 opacity-50" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-center">
            {tip}
          </TooltipContent>
        </UITooltip>
      </TooltipProvider>
    </th>
  );
}

interface DimensionReportProps {
  dimension: "customer" | "project" | "branch" | "brand" | "department" | "category" | "product";
  title: string;
  icon: React.ReactNode;
  statusFilter?: string;
  getDetailHref?: (rowName: string) => string;
}

interface DimensionData {
  kpis: {
    totalRequests: number;
    totalReservedQty: number;
    totalReleasedQty: number;
    totalRejectedQty: number;
    releaseRate: number;
    totalReservedValue: number;
    totalReleasedValue: number;
  };
  rows: {
    name: string;
    requestCount: number;
    reservedQty: number;
    releasedQty: number;
    rejectedQty: number;
    expiredQty: number;
    lostOpportunityQty: number;
    reservedValue: number;
    releasedValue: number;
    reservedCost: number;
    releasedCost: number;
    releaseRate: number;
  }[];
  chart: { name: string; reserved: number; released: number }[];
}

type SortField = "reservedValue" | "releasedValue" | "releaseRate" | "requestCount";
type ReleaseFilter = "all" | "high" | "medium" | "low";
type RiskFilter = "all" | "high" | "medium" | "low";

const PAGE_SIZE = 7;

export function ReportByDimension({ dimension, title, icon, statusFilter, getDetailHref }: DimensionReportProps) {
  const { token, user } = useAuth();
  const { t, isRTL } = useLang();
  const showCost = user?.role !== "branch_manager" && user?.role !== "sales_rep";
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [sortBy, setSortBy] = useState<SortField>("reservedValue");

  const qp = new URLSearchParams();
  if (dateFrom) qp.set("dateFrom", dateFrom);
  if (dateTo) qp.set("dateTo", dateTo);
  if (statusFilter && statusFilter !== "ALL") qp.set("status", statusFilter);
  const qs = qp.toString();

  const { data, isLoading } = useQuery<DimensionData>({
    queryKey: [`/api/reports/by-${dimension}`, qs],
    queryFn: async () => {
      const res = await fetch(`/api/reports/by-${dimension}${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load report data");
      return res.json();
    },
    enabled: !!token,
  });

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    let rows = [...data.rows];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }

    if (releaseFilter !== "all") {
      rows = rows.filter(r => {
        if (releaseFilter === "high") return r.releaseRate > 70;
        if (releaseFilter === "medium") return r.releaseRate >= 40 && r.releaseRate <= 70;
        return r.releaseRate < 40;
      });
    }

    if (riskFilter !== "all") {
      rows = rows.filter(r => {
        const unreleased = r.reservedQty - r.releasedQty;
        const riskRatio = r.reservedQty > 0 ? unreleased / r.reservedQty : 0;
        if (riskFilter === "high") return riskRatio > 0.6;
        if (riskFilter === "medium") return riskRatio >= 0.3 && riskRatio <= 0.6;
        return riskRatio < 0.3;
      });
    }

    rows.sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number));
    return rows;
  }, [data?.rows, searchQuery, releaseFilter, riskFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const summaryStats = useMemo(() => {
    if (!filteredRows.length && !data) return null;
    const rows = filteredRows;
    const totalReservedValue = rows.reduce((s, r) => s + r.reservedValue, 0);
    const totalReleasedValue = rows.reduce((s, r) => s + r.releasedValue, 0);
    const avgRelease = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.releaseRate, 0) / rows.length) : 0;
    return {
      totalEntities: rows.length,
      totalReservedValue,
      totalReleasedValue,
      avgReleaseRate: avgRelease,
    };
  }, [filteredRows, data]);

  const chartData = useMemo(() => {
    if (!data?.chart) return [];
    return data.chart;
  }, [data?.chart]);

  const clearAllFilters = () => {
    setSearchQuery("");
    setReleaseFilter("all");
    setRiskFilter("all");
    setSortBy("reservedValue");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasActiveFilters = searchQuery || releaseFilter !== "all" || riskFilter !== "all" || dateFrom || dateTo;

  return (
    <div className="space-y-3" dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid={`button-dim-${dimension}-clear-all`}>
            <X className="w-3.5 h-3.5" />
            <span className="text-xs">{t.planningReports.dimClearAll}</span>
          </Button>
        )}
      </div>

      <Card data-testid={`card-dim-${dimension}-filters`}>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-[280px]">
              <Search className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground ${isRTL ? "right-2.5" : "left-2.5"}`} />
              <Input
                placeholder={t.planningReports.dimSearch}
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className={isRTL ? "pr-8" : "pl-8"}
                data-testid={`input-dim-${dimension}-search`}
              />
            </div>
            <Select value={releaseFilter} onValueChange={(v) => { setReleaseFilter(v as ReleaseFilter); setPage(1); }}>
              <SelectTrigger className="w-[150px]" data-testid={`select-dim-${dimension}-release`}>
                <SelectValue placeholder={t.planningReports.dimReleaseFilter} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.planningReports.dimAllRatios}</SelectItem>
                <SelectItem value="high">{t.planningReports.dimHigh}</SelectItem>
                <SelectItem value="medium">{t.planningReports.dimMedium}</SelectItem>
                <SelectItem value="low">{t.planningReports.dimLow}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={riskFilter} onValueChange={(v) => { setRiskFilter(v as RiskFilter); setPage(1); }}>
              <SelectTrigger className="w-[150px]" data-testid={`select-dim-${dimension}-risk`}>
                <SelectValue placeholder={t.planningReports.dimRiskFilter} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.planningReports.dimAllRisk}</SelectItem>
                <SelectItem value="high">{t.planningReports.dimHighRisk}</SelectItem>
                <SelectItem value="medium">{t.planningReports.dimMediumRisk}</SelectItem>
                <SelectItem value="low">{t.planningReports.dimLowRisk}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => { setSortBy(v as SortField); setPage(1); }}>
              <SelectTrigger className="w-[160px]" data-testid={`select-dim-${dimension}-sort`}>
                <ArrowUpDown className="w-3.5 h-3.5" />
                <SelectValue placeholder={t.planningReports.dimSortBy} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reservedValue">{t.planningReports.dimSortReservedValue}</SelectItem>
                <SelectItem value="releasedValue">{t.planningReports.dimSortReleasedValue}</SelectItem>
                <SelectItem value="releaseRate">{t.planningReports.dimSortReleaseRate}</SelectItem>
                <SelectItem value="requestCount">{t.planningReports.dimSortRequests}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card data-testid={`card-dim-${dimension}-table`}>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir={isRTL ? "rtl" : "ltr"}>
              <thead>
                <tr className="bg-muted/50 border-b">
                  <ColHeader label={t.planningReports.dimName} tip={t.planningReports.dimTipName} isRTL={isRTL} />
                  <ColHeader label={t.planningReports.dimRequestCount} tip={t.planningReports.dimTipRequestCount} isRTL={isRTL} />
                  <ColHeader label={t.planningReports.dimReservedQty} tip={t.planningReports.dimTipReservedQty} isRTL={isRTL} />
                  <ColHeader label={t.planningReports.dimReleasedQty} tip={t.planningReports.dimTipReleasedQty} isRTL={isRTL} />
                  <ColHeader label={t.planningReports.dimRemainingQty} tip={t.planningReports.dimTipRemainingQty} isRTL={isRTL} />
                  <ColHeader label={t.planningReports.dimExpiredQty} tip={t.planningReports.dimTipExpiredQty} isRTL={isRTL} colorClass="text-gray-600 dark:text-gray-400" />
                  <ColHeader label={t.planningReports.dimLostOpportunityQty} tip={t.planningReports.dimTipLostOpportunityQty} isRTL={isRTL} colorClass="text-purple-600 dark:text-purple-400" />
                  <ColHeader label={t.planningReports.dimRejectedQty} tip={t.planningReports.dimTipRejectedQty} isRTL={isRTL} colorClass="text-red-600 dark:text-red-400" />
                  <ColHeader label={t.planningReports.dimReservedValue} tip={t.planningReports.dimTipReservedValue} isRTL={isRTL} />
                  {showCost && <ColHeader label={t.planningReports.dimReservedCost} tip={t.planningReports.dimTipReservedCost} isRTL={isRTL} />}
                  <ColHeader label={t.planningReports.dimReleasedValue} tip={t.planningReports.dimTipReleasedValue} isRTL={isRTL} />
                  {showCost && <ColHeader label={t.planningReports.dimReleasedCost} tip={t.planningReports.dimTipReleasedCost} isRTL={isRTL} />}
                  <ColHeader label={t.planningReports.dimReleaseRate} tip={t.planningReports.dimTipReleaseRate} isRTL={isRTL} />
                  {getDetailHref && <th className="p-3"></th>}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: showCost ? 13 : 11 }).map((_, j) => (
                        <td key={j} className="p-3"><Skeleton className="h-4 w-14" /></td>
                      ))}
                    </tr>
                  ))
                ) : pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={getDetailHref ? (showCost ? 14 : 12) : (showCost ? 13 : 11)} className="p-8 text-center text-muted-foreground">{t.planningReports.dimNoData}</td>
                  </tr>
                ) : pagedRows.map((row, i) => (
                  <tr key={row.name} className="border-b hover-elevate" data-testid={`row-dim-${dimension}-${i}`}>
                    <td className="p-3 font-medium max-w-[200px] truncate">{row.name}</td>
                    <td className="p-3 tabular-nums">{row.requestCount}</td>
                    <td className="p-3 tabular-nums">{row.reservedQty.toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-emerald-600 dark:text-emerald-400">{row.releasedQty.toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-orange-600 dark:text-orange-400">{(row.reservedQty - row.releasedQty - (row.expiredQty ?? 0)).toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-gray-600 dark:text-gray-400">{(row.expiredQty ?? 0).toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-purple-600 dark:text-purple-400">{(row.lostOpportunityQty ?? 0).toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-red-600 dark:text-red-400">{(row.rejectedQty ?? 0).toLocaleString()}</td>
                    <td className="p-3 tabular-nums">{row.reservedValue.toLocaleString()}</td>
                    {showCost && <td className="p-3 tabular-nums text-orange-600 dark:text-orange-400">{(row.reservedCost ?? 0).toLocaleString()}</td>}
                    <td className="p-3 tabular-nums text-emerald-600 dark:text-emerald-400">{row.releasedValue.toLocaleString()}</td>
                    {showCost && <td className="p-3 tabular-nums text-emerald-700 dark:text-emerald-300">{(row.releasedCost ?? 0).toLocaleString()}</td>}
                    <td className="p-3">
                      <Badge variant={row.releaseRate > 70 ? "default" : row.releaseRate > 40 ? "secondary" : "destructive"}>
                        {row.releaseRate}%
                      </Badge>
                    </td>
                    {getDetailHref && (
                      <td className="p-3">
                        <Link href={getDetailHref(row.name)}>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid={`button-dim-${dimension}-detail-${i}`}>
                            <Eye className="w-3 h-3" />
                            {isRTL ? "تفاصيل" : "Details"}
                          </Button>
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2 p-3 border-t">
            <span className="text-xs text-muted-foreground tabular-nums">
              {t.planningReports.perfPage} {page} {t.planningReports.perfOf} {totalPages} ({filteredRows.length})
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid={`button-dim-${dimension}-prev`}>
                {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid={`button-dim-${dimension}-next`}>
                {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
