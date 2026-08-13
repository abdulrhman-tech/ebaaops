import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Topbar } from "@/components/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, BellOff, CheckCheck, ExternalLink } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { Link } from "wouter";
import type { Notification } from "@shared/schema";

export default function NotificationsPage() {
  usePageTitle("الإشعارات");
  const { token } = useAuth();
  const { t, isRTL } = useLang();

  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t.notifications.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {unreadCount > 0 && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-3 h-3" />
              <span>{t.notifications.markAllRead}</span>
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-4 w-3/4 mt-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !notifications || notifications.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <BellOff className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-base font-medium text-muted-foreground">{t.notifications.noNotifications}</p>
              <p className="text-sm text-muted-foreground mt-1">{t.notifications.allCaughtUp}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {notifications.map((notif) => (
              <Card
                key={notif.id}
                className={`${!notif.isRead ? "border-r-2 border-r-primary" : ""}`}
                data-testid={`notification-${notif.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        notif.isRead ? "bg-muted" : "bg-primary/10"
                      }`}>
                        <Bell className={`w-3.5 h-3.5 ${notif.isRead ? "text-muted-foreground" : "text-primary"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm ${notif.isRead ? "text-muted-foreground" : "font-medium"}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {(() => { const d = new Date(notif.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; })()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {notif.link && (
                        <Link href={notif.link}>
                          <Button size="icon" variant="ghost" data-testid={`button-view-notif-${notif.id}`}>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                      )}
                      {!notif.isRead && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => markReadMutation.mutate(notif.id)}
                          data-testid={`button-read-notif-${notif.id}`}
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                        </Button>
                      )}
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
