import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { getRoleLabels } from "@/lib/role-utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  FileText,
  FilePlus,
  Package,
  Users,
  LogOut,
  Bell,
  History,
  Settings,
  Mail,
  MailCheck,
  BarChart3,
  PieChart,
  ShoppingCart,
  UserSearch,
  KeyRound,
  FolderKanban,
  LineChart,
} from "lucide-react";
import logoSrc from "@/assets/logo.png";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t, isRTL } = useLang();
  if (!user) return null;

  const roleLabels = getRoleLabels(t);

  const mainItems = [
    { title: t.nav.dashboard, url: "/", icon: LayoutDashboard },
    { title: t.nav.allRequests, url: "/requests", icon: FileText },
    { title: t.nav.newRequest, url: "/requests/new", icon: FilePlus },
  ];

  const managementItems: { title: string; url: string; icon: any }[] = [];
  if (user.role === "planning" || user.role === "admin") {
    managementItems.push({ title: t.nav.stockReleases, url: "/stock-releases", icon: Package });
    managementItems.push({ title: t.nav.products, url: "/products", icon: ShoppingCart });
    managementItems.push({ title: t.planningReports.title, url: "/planning-reports", icon: BarChart3 });
    managementItems.push({ title: t.nav.customers, url: "/customers", icon: UserSearch });
    managementItems.push({ title: t.nav.projects, url: "/projects", icon: FolderKanban });
    managementItems.push({ title: t.nav.mainReports, url: "/main-reports", icon: PieChart });
  }
  if (user.role === "sector_head") {
    managementItems.push({ title: t.nav.customers, url: "/customers", icon: UserSearch });
    managementItems.push({ title: t.nav.projects, url: "/projects", icon: FolderKanban });
    managementItems.push({ title: t.nav.mainReports, url: "/main-reports", icon: PieChart });
  }
  if (user.role === "category_manager") {
    managementItems.push({ title: t.nav.mainReports, url: "/main-reports", icon: PieChart });
  }
  if (user.role === "branch_manager") {
    managementItems.push({ title: t.nav.mainReports, url: "/main-reports", icon: PieChart });
  }
  if (user.role === "sales_rep") {
    managementItems.push({ title: t.nav.mainReports, url: "/main-reports", icon: PieChart });
  }
  if (user.role === "admin") {
    managementItems.push({ title: t.nav.users, url: "/users", icon: Users });
    managementItems.push({ title: t.nav.settings, url: "/settings", icon: Settings });
    managementItems.push({ title: t.emailLogs.title, url: "/email-logs", icon: Mail });
  }

  const systemItems = [
    { title: t.nav.notifications, url: "/notifications", icon: Bell },
    { title: t.nav.auditLog, url: "/audit-log", icon: History },
    { title: t.emailPreferences.title, url: "/email-preferences", icon: MailCheck },
    { title: t.changePassword.title, url: "/change-password", icon: KeyRound },
  ];

  const initials = user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <Sidebar side={isRTL ? "right" : "left"} data-testid="sidebar-main">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img src={logoSrc} alt={t.app.name} className="h-9 w-auto flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate" data-testid="text-sidebar-title">{t.app.name}</h2>
            <p className="text-xs text-muted-foreground truncate">{t.app.subtitle}</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t.nav.main}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={item.url === "/" ? location === "/" : location.startsWith(item.url)}
                  >
                    <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1) || "dashboard"}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {managementItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{t.nav.management}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {managementItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.startsWith(item.url)}
                    >
                      <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupLabel>{t.nav.system}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.startsWith(item.url)}
                  >
                    <Link href={item.url} data-testid={`link-${item.url.replace(/\//g, "-").slice(1)}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3">
          <Avatar className="w-8 h-8 flex-shrink-0">
            <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">{user.name}</p>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{roleLabels[user.role]}</Badge>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
