import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getRoleLabels, getStatusLabels, getDisplayStatus, getStatusVariant } from "@/lib/role-utils";
import { useLang } from "@/lib/i18n";
import { Link } from "wouter";
import { FileText, Package, CheckCircle, XCircle, Clock, ArrowRight, ArrowLeft, FilePlus } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Request, RequestItem, User } from "@shared/schema";

interface DashboardStats {
  totalRequests: number;
  pendingApproval: number;
  approved: number;
  rejected: number;
  recentRequests: (Request & { items: RequestItem[]; creator: User })[];
}

export default function DashboardPage() {
  usePageTitle("لوحة التحكم");
  const { token, user } = useAuth();
  const { t, isRTL } = useLang();
  const roleLabels = getRoleLabels(t);
  const statusLabels = getStatusLabels(t);

  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
  });

  const stats = [
    { label: t.dashboard.totalRequests, value: data?.totalRequests ?? 0, icon: FileText, color: "text-primary", url: "/requests" },
    { label: t.dashboard.pendingApproval, value: data?.pendingApproval ?? 0, icon: Clock, color: "text-amber-500", url: "/requests?status=pending" },
    { label: t.dashboard.approved, value: data?.approved ?? 0, icon: CheckCircle, color: "text-emerald-500", url: "/requests?status=final_approved" },
    { label: t.dashboard.rejected, value: data?.rejected ?? 0, icon: XCircle, color: "text-destructive", url: "/requests?status=rejected" },
  ];

  const ViewAllArrow = isRTL ? ArrowLeft : ArrowRight;

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.nav.dashboard} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold" data-testid="text-welcome">
              {t.dashboard.welcome} {user?.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t.dashboard.dashboardFor} {roleLabels[user?.role ?? "sales_rep"]}
            </p>
          </div>
          <Link href="/requests/new">
            <Button data-testid="button-new-request-dashboard">
              <FilePlus className="w-4 h-4" />
              <span>{t.nav.newRequest}</span>
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Link key={stat.label} href={stat.url}>
              <Card className="hover-elevate cursor-pointer" data-testid={`card-stat-${stat.label}`}>
                <CardContent className="p-4">
                  {isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-8 w-12" />
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                        <p className="text-2xl font-bold mt-1" data-testid={`text-stat-${stat.label}`}>
                          {stat.value}
                        </p>
                      </div>
                      <stat.icon className={`w-5 h-5 ${stat.color} flex-shrink-0`} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-base font-semibold">{t.dashboard.recentRequests}</h3>
            <Link href="/requests">
              <Button variant="ghost" size="sm" data-testid="link-view-all-requests">
                <span>{t.dashboard.viewAll}</span>
                <ViewAllArrow className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-5 w-20" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : data?.recentRequests && data.recentRequests.length > 0 ? (
              data.recentRequests.map((req) => (
                <Link key={req.id} href={`/requests/${req.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`card-request-${req.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm" data-testid={`text-request-number-${req.id}`}>
                              #{req.requestNumber}
                            </span>
                            <Badge variant={getStatusVariant(req.status as any)} className="text-[10px]">
                              {getDisplayStatus(req.status, (req as any).salesChannel, isRTL, t)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {req.items?.length ?? 0} {t.dashboard.products} · {t.dashboard.by} {req.creator?.name ?? t.dashboard.unknown}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {(() => { const d = new Date(req.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Package className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t.dashboard.noRequestsYet}</p>
                  <Link href="/requests/new">
                    <Button variant="outline" size="sm" className="mt-3">
                      {t.dashboard.createFirstRequest}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
