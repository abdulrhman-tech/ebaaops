import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  X,
  FolderKanban,
  ArrowUpDown,
  Eye,
  TrendingUp,
  DollarSign,
  Package,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

type ProjectRow = {
  projectName: string;
  totalRequests: number;
  totalReserved: number;
  totalReservedCost: number;
  totalReleased: number;
  totalReleasedCost: number;
  totalProfit: number;
  releaseRatio: number;
  lastActivity: string;
};

export default function ProjectsPage() {
  const { t, isRTL } = useLang();
  const { user, token } = useAuth();
  const pa = t.projectAnalytics;
  usePageTitle(pa.title);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("total_requests");
  const [sortDirection, setSortDirection] = useState("desc");

  const isAuthorized = user?.role === "planning" || user?.role === "admin" || user?.role === "sector_head";

  const qp = new URLSearchParams();
  if (search) qp.set("search", search);
  if (dateFrom) qp.set("date_from", dateFrom);
  if (dateTo) qp.set("date_to", dateTo);
  qp.set("sort_by", sortBy);
  qp.set("sort_direction", sortDirection);

  const { data, isLoading } = useQuery<ProjectRow[]>({
    queryKey: ["/api/projects", search, dateFrom, dateTo, sortBy, sortDirection],
    queryFn: async () => {
      const res = await fetch(`/api/projects?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
    enabled: !!token && isAuthorized,
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

  const handleSearch = () => setSearch(searchInput);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setSortBy("total_requests");
    setSortDirection("desc");
  };

  const hasFilters = search || dateFrom || dateTo;
  const projects = data || [];
  const totalReserved = projects.reduce((s, c) => s + c.totalReserved, 0);
  const totalReservedCost = projects.reduce((s, c) => s + (c.totalReservedCost ?? 0), 0);
  const totalReleased = projects.reduce((s, c) => s + c.totalReleased, 0);
  const totalReleasedCost = projects.reduce((s, c) => s + (c.totalReleasedCost ?? 0), 0);
  const totalProfit = projects.reduce((s, c) => s + c.totalProfit, 0);

  const sortOptions = [
    { value: "project_name", label: pa.sortByName },
    { value: "total_requests", label: pa.sortByRequests },
    { value: "total_reserved", label: pa.sortByReserved },
    { value: "total_released", label: pa.sortByReleased },
    { value: "total_profit", label: pa.sortByProfit },
    { value: "last_activity", label: pa.sortByActivity },
  ];

  return (
    <div className="flex flex-col h-full">
      <Topbar title={pa.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6" dir={isRTL ? "rtl" : "ltr"}>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-project-kpis">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{pa.totalRequests}</p>
                <FolderKanban className="w-4 h-4 text-blue-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-projects">{projects.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{pa.totalReserved}</p>
                <DollarSign className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-reserved">{totalReserved.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{pa.totalReservedCost}</p>
                <DollarSign className="w-4 h-4 text-orange-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-reserved-cost">{totalReservedCost.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{pa.totalReleased}</p>
                <Package className="w-4 h-4 text-teal-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-released">{totalReleased.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{pa.totalReleasedCost}</p>
                <Package className="w-4 h-4 text-orange-400 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-released-cost">{totalReleasedCost.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{pa.totalProfit}</p>
                <TrendingUp className="w-4 h-4 text-amber-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-profit">{totalProfit.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{pa.sar}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRTL ? "right-3" : "left-3"}`} />
                  <Input
                    placeholder={pa.searchPlaceholder}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className={isRTL ? "pr-9" : "pl-9"}
                    data-testid="input-project-search"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">{pa.dateFrom}</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[140px]"
                  data-testid="input-date-from"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">{pa.dateTo}</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-[140px]"
                  data-testid="input-date-to"
                />
              </div>
              <div className="flex items-center gap-2">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[150px]" data-testid="select-sort-by">
                    <SelectValue placeholder={pa.sortBy} />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setSortDirection(d => d === "asc" ? "desc" : "asc")}
                  data-testid="button-sort-direction"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </Button>
              </div>
              <Button size="sm" onClick={handleSearch} data-testid="button-search">
                <Search className="w-3.5 h-3.5" />
              </Button>
              {hasFilters && (
                <Button size="sm" variant="ghost" onClick={clearFilters} data-testid="button-clear-filters">
                  <X className="w-3.5 h-3.5" />
                  <span>{pa.clearFilters}</span>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-projects-table">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <FolderKanban className="w-8 h-8 opacity-50" />
                  <p data-testid="text-no-projects">{pa.noProjects}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-project-name">{pa.projectName}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-requests">{pa.totalRequests}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-reserved">{pa.totalReserved}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-reserved-cost">{pa.totalReservedCost}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-released">{pa.totalReleased}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-released-cost">{pa.totalReleasedCost}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-release-ratio">{pa.releaseRatio}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-profit">{pa.totalProfit}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-last-activity">{pa.lastActivity}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((p, i) => (
                      <TableRow key={i} data-testid={`row-project-${i}`}>
                        <TableCell className="font-medium" data-testid={`text-project-name-${i}`}>{p.projectName}</TableCell>
                        <TableCell data-testid={`text-total-requests-${i}`}>
                          <Badge variant="secondary">{p.totalRequests}</Badge>
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-total-reserved-${i}`}>
                          {p.totalReserved.toLocaleString()} {pa.sar}
                        </TableCell>
                        <TableCell className="tabular-nums text-orange-600 dark:text-orange-400" data-testid={`text-total-reserved-cost-${i}`}>
                          {(p.totalReservedCost ?? 0).toLocaleString()} {pa.sar}
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-total-released-${i}`}>
                          {p.totalReleased.toLocaleString()} {pa.sar}
                        </TableCell>
                        <TableCell className="tabular-nums text-orange-600 dark:text-orange-400" data-testid={`text-total-released-cost-${i}`}>
                          {(p.totalReleasedCost ?? 0).toLocaleString()} {pa.sar}
                        </TableCell>
                        <TableCell data-testid={`text-release-ratio-${i}`}>
                          <Badge variant={p.releaseRatio >= 80 ? "default" : p.releaseRatio >= 50 ? "secondary" : "outline"}>
                            {p.releaseRatio}%
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-total-profit-${i}`}>
                          {p.totalProfit.toLocaleString()} {pa.sar}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm tabular-nums" data-testid={`text-last-activity-${i}`}>
                          {p.lastActivity ? new Date(p.lastActivity).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell>
                          <Link href={`/projects/${encodeURIComponent(p.projectName)}`}>
                            <Button size="sm" variant="outline" data-testid={`button-view-project-${i}`}>
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

      </div>
    </div>
  );
}
