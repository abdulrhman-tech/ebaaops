import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LangProvider, useLang } from "@/lib/i18n";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import RequestsListPage from "@/pages/requests-list";
import RequestCreatePage from "@/pages/request-create";
import RequestDetailPage from "@/pages/request-detail";
import NotificationsPage from "@/pages/notifications";
import AuditLogPage from "@/pages/audit-log";
import StockReleasesPage from "@/pages/stock-releases";
import UsersPage from "@/pages/users";
import AdminSettingsPage from "@/pages/admin-settings";
import EmailLogsPage from "@/pages/email-logs";
import EmailPreferencesPage from "@/pages/email-preferences";
import PlanningReportsPage from "@/pages/planning-reports";
import SalesRepReportsPage from "@/pages/sales-rep-reports";
import ProductsPage from "@/pages/products";
import CustomersPage from "@/pages/customers";
import CustomerDetailPage from "@/pages/customer-detail";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import MainReportsPage from "@/pages/main-reports";
import CategoryReportDetailPage from "@/pages/category-report-detail";
import ProductReportDetailPage from "@/pages/product-report-detail";
import DimReportDetailPage from "@/pages/dim-report-detail";
import ChangePasswordPage from "@/pages/change-password";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/requests" component={RequestsListPage} />
      <Route path="/requests/new" component={RequestCreatePage} />
      <Route path="/requests/:id" component={RequestDetailPage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/audit-log" component={AuditLogPage} />
      <Route path="/stock-releases" component={StockReleasesPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/settings" component={AdminSettingsPage} />
      <Route path="/email-logs" component={EmailLogsPage} />
      <Route path="/email-preferences" component={EmailPreferencesPage} />
      <Route path="/planning-reports" component={PlanningReportsPage} />
      <Route path="/sales-rep-reports" component={SalesRepReportsPage} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/customers" component={CustomersPage} />
      <Route path="/customers/:name" component={CustomerDetailPage} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/projects/:name" component={ProjectDetailPage} />
      <Route path="/main-reports" component={MainReportsPage} />
      <Route path="/reports/category/:name" component={CategoryReportDetailPage} />
      <Route path="/reports/product/:code" component={ProductReportDetailPage} />
      <Route path="/reports/dim/:dimension/:value" component={DimReportDetailPage} />
      <Route path="/change-password" component={ChangePasswordPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const { isRTL } = useLang();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Router />
        </main>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LangProvider>
          <AuthProvider>
            <div className="transition-opacity duration-200">
              <AuthenticatedApp />
            </div>
          </AuthProvider>
        </LangProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
