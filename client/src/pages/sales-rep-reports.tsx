import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { usePageTitle } from "@/hooks/use-page-title";
import { Package, Truck, Snowflake, AlertTriangle, TrendingUp, LayoutGrid, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function SalesRepReportsPage() {
  const { t } = useLang();
  usePageTitle(t.salesRepReports.title);
  const { token } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/sales-rep"],
    queryFn: async () => {
      const res = await fetch("/api/reports/sales-rep", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch reports");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title={t.salesRepReports.title} />
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const { summary, projects } = data || { summary: {}, projects: [] };

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.salesRepReports.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="general">{t.salesRepReports.generalTab}</TabsTrigger>
            <TabsTrigger value="projects">{t.salesRepReports.projectsTab}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{t.salesRepReports.totalReserved}</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="text-2xl font-bold">{summary.totalReserved?.toLocaleString() || 0}</div>
                  <p className="text-[11px] text-muted-foreground font-mono leading-tight">
                    {t.salesRepReports.formulaReserved}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{t.salesRepReports.totalReleased}</CardTitle>
                  <Truck className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="text-2xl font-bold">{summary.totalReleased?.toLocaleString() || 0}</div>
                  <p className="text-[11px] text-muted-foreground font-mono leading-tight">
                    {t.salesRepReports.formulaReleased}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{t.salesRepReports.totalFrozen}</CardTitle>
                  <Snowflake className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="text-2xl font-bold">{summary.totalFrozen?.toLocaleString() || 0}</div>
                  <p className="text-[11px] text-muted-foreground font-mono leading-tight">
                    {t.salesRepReports.formulaFrozen}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{t.salesRepReports.expiringSoon}</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="text-2xl font-bold text-destructive">{summary.expiringSoonCount || 0}</div>
                  <p className="text-[11px] text-muted-foreground font-mono leading-tight">
                    {t.salesRepReports.formulaExpiringSoon}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  {t.salesRepReports.salesValue}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-3xl font-bold text-primary">
                  {summary.totalSalesValue?.toLocaleString() || 0}{" "}
                  <span className="text-sm font-normal text-muted-foreground">{t.requestDetail.sar}</span>
                </div>
                <p className="text-[12px] text-muted-foreground font-mono">
                  {t.salesRepReports.formulaSalesValue}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="projects" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <LayoutGrid className="h-5 w-5 text-primary" />
                  {t.salesRepReports.projectsTab}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {projects.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">{t.salesRepReports.noData}</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.salesRepReports.projectName}</TableHead>
                        <TableHead className="text-center">{t.salesRepReports.requestCount}</TableHead>
                        <TableHead className="text-right">
                          <div>{t.salesRepReports.totalReserved}</div>
                          <div className="text-[10px] font-mono text-muted-foreground font-normal">
                            {t.salesRepReports.formulaProjectReserved}
                          </div>
                        </TableHead>
                        <TableHead className="text-right">
                          <div>{t.salesRepReports.totalReleased}</div>
                          <div className="text-[10px] font-mono text-muted-foreground font-normal">
                            {t.salesRepReports.formulaProjectReleased}
                          </div>
                        </TableHead>
                        <TableHead className="text-right">
                          <div>{t.salesRepReports.salesValue}</div>
                          <div className="text-[10px] font-mono text-muted-foreground font-normal">
                            {t.salesRepReports.formulaProjectSalesValue}
                          </div>
                        </TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projects.map((project: any) => (
                        <TableRow key={project.name}>
                          <TableCell className="font-medium">{project.name}</TableCell>
                          <TableCell className="text-center">{project.requestCount}</TableCell>
                          <TableCell className="text-right">{project.reserved.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{project.released.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {project.salesValue.toLocaleString()} {t.requestDetail.sar}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/projects/${encodeURIComponent(project.name)}`}>
                              <Button variant="ghost" size="sm" className="gap-2">
                                <Eye className="h-4 w-4" />
                                {t.salesRepReports.viewDetails}
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
