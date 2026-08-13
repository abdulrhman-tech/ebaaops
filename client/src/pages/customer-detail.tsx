import { useState } from "react";
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
  ChevronLeft,
  ChevronRight,
  Eye,
  Users,
  DollarSign,
  Package,
  TrendingUp,
  Percent,
  X,
  FileText,
} from "lucide-react";
import type { RequestStatus } from "@shared/schema";

type CustomerDetailData = {
  summary: {
    customerName: string;
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
    reservedValue: number;
    releasedValue: number;
    profit: number;
  }[];
};

export default function CustomerDetailPage() {
  const { t, isRTL } = useLang();
  const { user, token } = useAuth();
  const ca = t.customerAnalytics;
  const statusLabels = getStatusLabels(t);

  const [, params] = useRoute("/customers/:name");
  const customerName = params?.name ? decodeURIComponent(params.name) : "";

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const isAuthorized = user?.role === "planning" || user?.role === "admin" || user?.role === "sector_head";

  const qp = new URLSearchParams();
  if (dateFrom) qp.set("date_from", dateFrom);
  if (dateTo) qp.set("date_to", dateTo);

  const { data, isLoading } = useQuery<CustomerDetailData>({
    queryKey: ["/api/customers", customerName, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${encodeURIComponent(customerName)}?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load customer");
      return res.json();
    },
    enabled: !!token && isAuthorized && !!customerName,
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

  const BackIcon = isRTL ? ChevronRight : ChevronLeft;
  const summary = data?.summary;
  const requests = data?.requests || [];

  return (
    <div className="flex flex-col h-full">
      <Topbar title={ca.customerDetails} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6" dir={isRTL ? "rtl" : "ltr"}>

        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/customers">
            <Button variant="ghost" size="sm" data-testid="button-back-to-customers">
              <BackIcon className="w-4 h-4" />
              <span>{ca.backToCustomers}</span>
            </Button>
          </Link>
          <h2 className="text-xl font-bold" data-testid="text-customer-name">{customerName}</h2>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" data-testid="section-customer-summary">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{ca.totalRequests}</p>
                  <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-requests">{summary.totalRequests}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{ca.totalReserved}</p>
                  <DollarSign className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-reserved">{summary.totalReserved.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{ca.totalReleased}</p>
                  <Package className="w-4 h-4 text-teal-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-released">{summary.totalReleased.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{ca.releaseRatio}</p>
                  <Percent className="w-4 h-4 text-amber-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-release-ratio">{summary.releaseRatio}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-1 mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{ca.totalProfit}</p>
                  <TrendingUp className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                </div>
                <p className="text-2xl font-bold" data-testid="text-summary-total-profit">{summary.totalProfit.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{ca.sar}</p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Card data-testid="card-customer-requests">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-semibold">{ca.totalRequests}: {requests.length}</span>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">{ca.dateFrom}</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-detail-date-from"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">{ca.dateTo}</label>
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
                  <p data-testid="text-no-requests">{ca.noRequests}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-request-number">{ca.requestNumber}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-status">{ca.status}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-reserved-value">{ca.reservedValue}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-released-value">{ca.releasedValue}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-profit">{ca.profit}</TableHead>
                      <TableHead className={isRTL ? "text-right" : "text-left"} data-testid="th-created-at">{ca.createdAt}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r, i) => (
                      <TableRow key={r.id} data-testid={`row-request-${i}`}>
                        <TableCell className="font-mono text-sm" data-testid={`text-request-number-${i}`}>{r.requestNumber}</TableCell>
                        <TableCell data-testid={`text-request-status-${i}`}>
                          <Badge variant={getStatusVariant(r.status as RequestStatus)}>
                            {statusLabels[r.status as RequestStatus] || r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-request-reserved-${i}`}>
                          {r.reservedValue.toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-request-released-${i}`}>
                          {r.releasedValue.toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-request-profit-${i}`}>
                          {r.profit.toLocaleString()} {ca.sar}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm tabular-nums" data-testid={`text-request-date-${i}`}>
                          {new Date(r.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Link href={`/requests/${r.id}`}>
                            <Button size="sm" variant="outline" data-testid={`button-view-request-${i}`}>
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
