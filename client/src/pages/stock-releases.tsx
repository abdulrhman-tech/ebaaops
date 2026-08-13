import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Truck, Package } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { Link } from "wouter";
import { getStockReleaseStatusLabels, getStockReleaseStatusVariant } from "@/lib/role-utils";
import type { StockRelease, StockReleaseItem, RequestItem, User, Request } from "@shared/schema";

type StockReleaseWithRelations = StockRelease & {
  items: (StockReleaseItem & { requestItem: RequestItem })[];
  creator: User;
  request: Request;
};

export default function StockReleasesPage() {
  usePageTitle("أوامر الصرف");
  const { token } = useAuth();
  const { t, isRTL } = useLang();
  const stockReleaseStatusLabels = getStockReleaseStatusLabels(t);

  const { data: releases, isLoading } = useQuery<StockReleaseWithRelations[]>({
    queryKey: ["/api/stock-releases"],
    queryFn: async () => {
      const res = await fetch("/api/stock-releases", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.stockReleases.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-4 w-2/3 mt-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !releases || releases.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Truck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-base font-medium text-muted-foreground">{t.stockReleases.noReleases}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {releases.map((release) => (
              <Card key={release.id} data-testid={`stock-release-${release.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                        <Truck className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t.stockReleases.release} #{release.id}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.stockReleases.request} #{release.request?.requestNumber} · {t.stockReleases.by} {release.creator?.name}
                        </p>
                      </div>
                    </div>
                    <Badge variant={getStockReleaseStatusVariant(release.status)}>
                      {stockReleaseStatusLabels[release.status] || release.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {release.items.map((ri) => (
                      <Badge key={ri.id} variant="secondary" className="text-xs">
                        <Package className="w-3 h-3" />
                        <span>{ri.requestItem?.itemCode}: {ri.quantity}</span>
                      </Badge>
                    ))}
                  </div>
                  {release.notes && (
                    <p className="text-xs text-muted-foreground mt-2 italic">"{release.notes}"</p>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      {(() => { const d = new Date(release.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; })()}
                    </span>
                    <Link href={`/requests/${release.requestId}`}>
                      <Button variant="ghost" size="sm" data-testid={`button-view-request-${release.id}`}>
                        {t.stockReleases.viewRequest}
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
