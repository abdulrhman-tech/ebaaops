import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useRoute, Link } from "wouter";
import { getStatusLabels, getStatusVariant } from "@/lib/role-utils";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FolderKanban,
  DollarSign,
  Package,
  TrendingUp,
  Percent,
  X,
  FileText,
  Users,
  ShoppingCart,
  Tag,
  Store,
  Layers,
  LayoutGrid,
  Search,
  ArrowUpDown,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { usePageTitle } from "@/hooks/use-page-title";
import type { RequestStatus } from "@shared/schema";

type ProjectDetailData = {
  summary: {
    projectName: string;
    totalRequests: number;
    totalReserved: number;
    totalReleased: number;
    totalProfit: number;
    releaseRatio: number;
  };
  requests: {
    id: number;
    requestNumber: string;
    status: string;
    createdAt: string;
    customerName: string;
    reservedValue: number;
    releasedValue: number;
    profit: number;
  }[];
};

type DimensionData = {
  kpis: {
    totalRequests: number;
    totalReservedQty: number;
    totalReleasedQty: number;
    releaseRate: number;
    totalReservedValue: number;
    totalReleasedValue: number;
  };
  rows: {
    name: string;
    requestCount: number;
    reservedQty: number;
    releasedQty: number;
    reservedValue: number;
    releasedValue: number;
    releaseRate: number;
  }[];
  chart: { name: string; reserved: number; released: number }[];
};

const PAGE_SIZE = 7;

function ProjectDimensionReport({ projectName, dimension, label }: { projectName: string; dimension: string; label: string }) {
  const { token } = useAuth();
  const { t, isRTL } = useLang();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery<DimensionData>({
    queryKey: ["/api/projects", projectName, "reports", dimension],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/reports/${dimension}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!token && !!projectName,
  });

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    let rows = [...data.rows];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }
    rows.sort((a, b) => b.reservedValue - a.reservedValue);
    return rows;
  }, [data?.rows, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4" dir={isRTL ? "rtl" : "ltr"}>
      {data?.chart && data.chart.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-3">{t.planningReports.dimChartTitle}</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.chart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="reserved" name={t.planningReports.dimReserved} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="released" name={t.planningReports.dimReleased} fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-[280px]">
          <Search className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground ${isRTL ? "right-2.5" : "left-2.5"}`} />
          <Input
            placeholder={t.planningReports.dimSearch}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className={isRTL ? "pr-8" : "pl-8"}
            data-testid={`input-project-dim-${dimension}-search`}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir={isRTL ? "rtl" : "ltr"}>
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimName}</th>
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimRequestCount}</th>
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimReservedQty}</th>
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimReleasedQty}</th>
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimRemainingQty}</th>
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimReservedValue}</th>
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimReleasedValue}</th>
                  <th className={`p-3 font-medium ${isRTL ? "text-right" : "text-left"}`}>{t.planningReports.dimReleaseRate}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="p-3"><Skeleton className="h-4 w-14" /></td>
                      ))}
                    </tr>
                  ))
                ) : pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">{t.planningReports.dimNoData}</td>
                  </tr>
                ) : pagedRows.map((row, i) => (
                  <tr key={row.name} className="border-b hover:bg-muted/30" data-testid={`row-project-dim-${dimension}-${i}`}>
                    <td className="p-3 font-medium max-w-[200px] truncate">{row.name}</td>
                    <td className="p-3 tabular-nums">{row.requestCount}</td>
                    <td className="p-3 tabular-nums">{row.reservedQty.toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-emerald-600 dark:text-emerald-400">{row.releasedQty.toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-orange-600 dark:text-orange-400">{(row.reservedQty - row.releasedQty).toLocaleString()}</td>
                    <td className="p-3 tabular-nums">{row.reservedValue.toLocaleString()}</td>
                    <td className="p-3 tabular-nums text-emerald-600 dark:text-emerald-400">{row.releasedValue.toLocaleString()}</td>
                    <td className="p-3">
                      <Badge variant={row.releaseRate > 70 ? "default" : row.releaseRate > 40 ? "secondary" : "destructive"}>
                        {row.releaseRate}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 p-3 border-t">
              <span className="text-xs text-muted-foreground tabular-nums">
                {t.planningReports.perfPage} {page} {t.planningReports.perfOf} {totalPages} ({filteredRows.length})
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </Button>
                <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { t, isRTL } = useLang();
  const { user, token } = useAuth();
  const pa = t.projectAnalytics;
  const statusLabels = getStatusLabels(t);
  usePageTitle(pa.projectDetails);

  const [, params] = useRoute("/projects/:name");
  const projectName = params?.name ? decodeURIComponent(params.name) : "";

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const isAuthorized = user?.role === "planning" || user?.role === "admin" || user?.role === "sector_head";

  const qp = new URLSearchParams();
  if (dateFrom) qp.set("date_from", dateFrom);
  if (dateTo) qp.set("date_to", dateTo);

  const { data, isLoading } = useQuery<ProjectDetailData>({
    queryKey: ["/api/projects", projectName, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load project");
      return res.json();
    },
    enabled: !!token && isAuthorized && !!projectName,
  });

  if (!isAuthorized) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={pa.title} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground" data-testid="text-access-denied">{pa.accessDenied}</p>
        </div>
      </div>
    );
  }

  const BackIcon = isRTL ? ChevronRight : ChevronLeft;
  const summary = data?.summary;
  const requests = data?.requests || [];

  const reportTabs = [
    { key: "requests", label: pa.tabRequests, icon: FileText },
    { key: "customer", label: pa.tabByCustomer, icon: Users },
    { key: "product", label: pa.tabByProduct, icon: ShoppingCart },
    { key: "brand", label: pa.tabByBrand, icon: Tag },
    { key: "branch", label: pa.tabByBranch, icon: Store },
    { key: "department", label: pa.tabByDepartment, icon: Layers },
    { key: "category", label: pa.tabByCategory, icon: LayoutGrid },
  ];

  return (
    <div className="flex flex-col h-full">
      <Topbar title={pa.projectDetails} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6" dir={isRTL ? "rtl" : "ltr"}>

        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/projects">
            <Button variant="ghost" size="sm" data-testid="button-back-to-projects">
              <BackIcon className="w-4 h-4" />
              <span>{pa.backToProjects}</span>
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold" data-testid="text-project-name">{projectName}</h2>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" data-testid="section-project-summary">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{pa.totalRequests}</p>
                  <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-requests">{summary.totalRequests}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{pa.totalReserved}</p>
                  <DollarSign className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-reserved">{summary.totalReserved.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{pa.totalReleased}</p>
                  <Package className="w-4 h-4 text-teal-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-released">{summary.totalReleased.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{pa.releaseRatio}</p>
                  <Percent className="w-4 h-4 text-amber-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-release-ratio">{summary.releaseRatio}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{pa.totalProfit}</p>
                  <TrendingUp className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-profit">{summary.totalProfit.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Tabs defaultValue="requests" className="w-full" dir={isRTL ? "rtl" : "ltr"}>
          <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-lg">
            {reportTabs.map((tab) => (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="flex items-center gap-1.5 text-xs px-3 py-2"
                data-testid={`tab-project-${tab.key}`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="requests" className="mt-4">
            <Card data-testid="card-project-requests">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm font-semibold">{pa.totalRequests}: {requests.length}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">{pa.dateFrom}</label>
                      <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="w-[140px]"
                        data-testid="input-detail-date-from"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">{pa.dateTo}</label>
                      <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="w-[140px]"
                        data-testid="input-detail-date-to"
                      />
                    </div>
                    {(dateFrom || dateTo) && (
                      <Button variant="ghost" size="icon" onClick={() => { setDateFrom(""); setDateTo(""); }} data-testid="button-detail-clear-dates">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  {isLoading ? (
                    <div className="p-6 space-y-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : requests.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                      <FileText className="w-8 h-8 opacity-50" />
                      <p data-testid="text-no-requests">{pa.noRequests}</p>
                    </div>
                  ) : (
                    <Table dir={isRTL ? "rtl" : "ltr"}>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">{pa.requestNumber}</TableHead>
                          <TableHead className="text-right">{pa.status}</TableHead>
                          <TableHead className="text-right">{t.customerAnalytics.customerName}</TableHead>
                          <TableHead className="text-right">{pa.reservedValue}</TableHead>
                          <TableHead className="text-right">{pa.releasedValue}</TableHead>
                          <TableHead className="text-right">{pa.createdAt}</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requests.map((r, i) => (
                          <TableRow key={r.id} data-testid={`row-request-${i}`}>
                            <TableCell className="font-mono text-sm">{r.requestNumber}</TableCell>
                            <TableCell>
                              <Badge variant={getStatusVariant(r.status as RequestStatus)}>
                                {statusLabels[r.status as RequestStatus] || r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{r.customerName}</TableCell>
                            <TableCell className="tabular-nums">{r.reservedValue.toLocaleString()} {pa.sar}</TableCell>
                            <TableCell className="tabular-nums">{r.releasedValue.toLocaleString()} {pa.sar}</TableCell>
                            <TableCell className="text-muted-foreground text-sm tabular-nums">
                              {new Date(r.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Link href={`/requests/${r.id}`}>
                                <Button size="sm" variant="outline" data-testid={`button-view-request-${i}`}>
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>{pa.view}</span>
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {["customer", "product", "brand", "branch", "department", "category"].map((dim) => (
            <TabsContent key={dim} value={dim} className="mt-4">
              <ProjectDimensionReport
                projectName={projectName}
                dimension={dim}
                label={reportTabs.find(t => t.key === dim)?.label || dim}
              />
            </TabsContent>
          ))}
        </Tabs>

      </div>
    </div>
  );
}
