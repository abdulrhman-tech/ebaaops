import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { LanguageToggle } from "@/components/language-toggle";

export function Topbar({ title }: { title?: string }) {
  const { token } = useAuth();

  const { data: notifData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    enabled: !!token,
    refetchInterval: 30000,
    queryFn: async () => {
      const res = await fetch("/api/notifications/unread-count", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
  });

  const unreadCount = notifData?.count ?? 0;

  return (
    <header className="flex items-center justify-between gap-4 p-3 border-b bg-background sticky top-0 z-50">
      <div className="flex items-center gap-3 min-w-0">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        {title && (
          <h1 className="text-lg font-semibold truncate" data-testid="text-page-title">{title}</h1>
        )}
      </div>
      <div className="flex items-center gap-2">
        <LanguageToggle />
        <Link href="/notifications">
          <Button size="icon" variant="ghost" className="relative" data-testid="button-notifications">
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -left-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] rounded-full flex items-center justify-center font-medium">
                {unreadCount > 9 ? "+9" : unreadCount}
              </span>
            )}
          </Button>
        </Link>
      </div>
    </header>
  );
}
