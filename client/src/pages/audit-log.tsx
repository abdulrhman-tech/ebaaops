import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { History, FileText } from "lucide-react";
import { useLang } from "@/lib/i18n";
import type { AuditLog, User } from "@shared/schema";

type AuditLogWithUser = AuditLog & { user: User };

export default function AuditLogPage() {
  usePageTitle("سجل المراجعة");
  const { token } = useAuth();
  const { t, isRTL } = useLang();

  const { data: logs, isLoading } = useQuery<AuditLogWithUser[]>({
    queryKey: ["/api/audit-logs"],
    queryFn: async () => {
      const res = await fetch("/api/audit-logs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.auditLog.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-4 w-2/3 mt-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !logs || logs.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-base font-medium text-muted-foreground">{t.auditLog.noLogs}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <Card key={log.id} data-testid={`audit-entry-${log.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{log.user?.name ?? t.auditLog.system}</span>{" "}
                        <span className="text-muted-foreground">{log.action}</span>{" "}
                        <span className="text-muted-foreground">{t.auditLog.on} {log.entity} #{log.entityId}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(() => { const d = new Date(log.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; })()}
                      </p>
                    </div>
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
