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
  Users,
  ArrowUpDown,
  Eye,
  TrendingUp,
  DollarSign,
  Package,
  Percent,
} from "lucide-react";

type CustomerRow = {
  customerName: string;
  totalRequests: number;
  totalReserved: number;
  totalReservedCost: number;
  totalReleased: number;
  totalReleasedCost: number;
  totalProfit: number;
  releaseRatio: number;
  lastActivity: string;
};

export default function CustomersPage() {
  const { t, isRTL } = useLang();
  const { user, token } = useAuth();
  const ca = t.customerAnalytics;

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

  const { data, isLoading } = useQuery<CustomerRow[]>({
    queryKey: ["/api/customers", search, dateFrom, dateTo, sortBy, sortDirection],
    queryFn: async () => {
      const res = await fetch(`/api/customers?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load customers");
      return res.json();
    },
    enabled: !!token && isAuthorized,
  });

  if (!isAuthorized) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={ca.title} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground" data-testid="text-access-denied">{ca.accessDenied}</p>
        </div>
      </div>
    );
  }

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setSortBy("total_requests");
    setSortDirection("desc");
  };

  const hasFilters = search || dateFrom || dateTo;

  const customers = data || [];

  const totalReserved = customers.reduce((s, c) => s + c.totalReserved, 0);
  const totalReservedCost = customers.reduce((s, c) => s + (c.totalReservedCost ?? 0), 0);
  const totalReleased = customers.reduce((s, c) => s + c.totalReleased, 0);
  const totalReleasedCost = customers.reduce((s, c) => s + (c.totalReleasedCost ?? 0), 0);
  const totalProfit = customers.reduce((s, c) => s + c.totalProfit, 0);
  const overallRatio = totalReserved > 0 ? Math.round((totalReleased / totalReserved) * 1000) / 10 : 0;

  const sortOptions = [
    { value: "customer_name", label: ca.sortByName },
    { value: "total_requests", label: ca.sortByRequests },
    { value: "total_reserved", label: ca.sortByReserved },
    { value: "total_released", label: ca.sortByReleased },
    { value: "total_profit", label: ca.sortByProfit },
    { value: "last_activity", label: ca.sortByActivity },
  ];

  return (
    <div className="flex flex-col h-full">
      <Topbar title={ca.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6" dir={isRTL ? "rtl" : "ltr"}>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-customer-kpis">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{ca.totalRequests}</p>
                <Users className="w-4 h-4 text-blue-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-customers">{customers.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{ca.totalReserved}</p>
                <DollarSign className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-reserved">{totalReserved.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{ca.totalReservedCost}</p>
                <DollarSign className="w-4 h-4 text-orange-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-reserved-cost">{totalReservedCost.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{ca.totalReleased}</p>
                <Package className="w-4 h-4 text-teal-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-released">{totalReleased.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{ca.totalReleasedCost}</p>
                <Package className="w-4 h-4 text-orange-400 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-released-cost">{totalReleasedCost.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-1 mb-2">
                <p className="text-xs text-muted-foreground font-medium">{ca.totalProfit}</p>
                <TrendingUp className="w-4 h-4 text-amber-500 flex-shrink-0" />
              </div>
              <p className="text-2xl font-bold" data-testid="text-kpi-total-profit">{totalProfit.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
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
                    placeholder={ca.searchPlaceholder}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className={isRTL ? "pr-9" : "pl-9"}
                    data-testid="input-customer-search"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">{ca.dateFrom}</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[140px]"
                  data-testid="input-date-from"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">{ca.dateTo}</label>
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
                    <SelectValue placeholder={ca.sortBy} />
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
                  <span>{ca.clearFilters}</span>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-customers-table">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : customers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Users className="w-8 h-8 opacity-50" />
                  <p data-testid="text-no-customers">{ca.noCustomers}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-customer-name">{ca.customerName}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-requests">{ca.totalRequests}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-reserved">{ca.totalReserved}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-reserved-cost">{ca.totalReservedCost}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-released">{ca.totalReleased}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-released-cost">{ca.totalReleasedCost}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-release-ratio">{ca.releaseRatio}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-total-profit">{ca.totalProfit}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-last-activity">{ca.lastActivity}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((c, i) => (
                      <TableRow key={i} data-testid={`row-customer-${i}`}>
                        <TableCell className="font-medium" data-testid={`text-customer-name-${i}`}>{c.customerName}</TableCell>
                        <TableCell data-testid={`text-total-requests-${i}`}>
                          <Badge variant="secondary">{c.totalRequests}</Badge>
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-total-reserved-${i}`}>
                          {c.totalReserved.toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell className="tabular-nums text-orange-600 dark:text-orange-400" data-testid={`text-total-reserved-cost-${i}`}>
                          {(c.totalReservedCost ?? 0).toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-total-released-${i}`}>
                          {c.totalReleased.toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell className="tabular-nums text-orange-600 dark:text-orange-400" data-testid={`text-total-released-cost-${i}`}>
                          {(c.totalReleasedCost ?? 0).toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell data-testid={`text-release-ratio-${i}`}>
                          <Badge variant={c.releaseRatio >= 80 ? "default" : c.releaseRatio >= 50 ? "secondary" : "outline"}>
                            {c.releaseRatio}%
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-total-profit-${i}`}>
                          {c.totalProfit.toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm tabular-nums" data-testid={`text-last-activity-${i}`}>
                          {c.lastActivity ? new Date(c.lastActivity).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell>
                          <Link href={`/customers/${encodeURIComponent(c.customerName)}`}>
                            <Button size="sm" variant="outline" data-testid={`button-view-customer-${i}`}>
                              <Eye className="w-3.5 h-3.5" />
                              <span>{ca.view}</span>
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
