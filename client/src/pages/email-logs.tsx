import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail, ChevronLeft, ChevronRight, Search, AlertCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const EVENT_TYPES = [
  "request_created",
  "request_approved",
  "request_rejected",
  "request_final_approved",
  "request_edited",
  "stock_release_requested",
  "stock_release_approved",
  "stock_release_rejected",
  "stock_release_final_approved",
] as const;

export default function EmailLogsPage() {
  usePageTitle("سجل البريد الإلكتروني");
  const { t, isRTL } = useLang();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailSearch, setEmailSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">{t.adminSettings.adminRequired}</p>
      </div>
    );
  }

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", "20");
  if (eventFilter !== "all") queryParams.set("eventType", eventFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (emailSearch) queryParams.set("recipientEmail", emailSearch);

  const { data, isLoading } = useQuery<{
    logs: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ["/api/email-logs", page, eventFilter, statusFilter, emailSearch],
    queryFn: async () => {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/email-logs?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch email logs");
      return res.json();
    },
  });

  const eventLabels = t.emailLogs.events as Record<string, string>;

  const handleSearch = () => {
    setEmailSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold" data-testid="text-email-logs-title">{t.emailLogs.title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-3 p-4 border-b flex-wrap">
        <Select value={eventFilter} onValueChange={(v) => { setEventFilter(v); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-event-filter">
            <SelectValue placeholder={t.emailLogs.filterByEvent} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.emailLogs.allEvents}</SelectItem>
            {EVENT_TYPES.map(e => (
              <SelectItem key={e} value={e}>{eventLabels[e] || e}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder={t.emailLogs.filterByStatus} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.emailLogs.allStatuses}</SelectItem>
            <SelectItem value="sent">{t.emailLogs.sent}</SelectItem>
            <SelectItem value="failed">{t.emailLogs.failed}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t.emailLogs.searchEmail}
            className="w-48"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            data-testid="input-email-search"
          />
          <Button size="icon" variant="ghost" onClick={handleSearch} data-testid="button-search-email">
            <Search className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.logs?.length ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Mail className="w-8 h-8 mb-2 opacity-50" />
            <p>{t.emailLogs.noLogs}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.logs.map((log: any) => (
              <Card key={log.id} className="p-3" data-testid={`card-email-log-${log.id}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant={log.status === "sent" ? "default" : "destructive"} data-testid={`badge-status-${log.id}`}>
                        {log.status === "sent" ? t.emailLogs.sent : t.emailLogs.failed}
                      </Badge>
                      <Badge variant="outline" data-testid={`badge-event-${log.id}`}>
                        {eventLabels[log.eventType] || log.eventType}
                      </Badge>
                      {log.retryCount > 0 && (
                        <Badge variant="secondary">
                          {t.emailLogs.retries}: {log.retryCount}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate" data-testid={`text-recipient-${log.id}`}>
                      {log.recipientName || log.recipientEmail}
                      {log.recipientName && (
                        <span className="text-muted-foreground ms-1 text-xs">({log.recipientEmail})</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-subject-${log.id}`}>
                      {log.subject}
                    </p>
                    {log.errorMessage && (
                      <div className="flex items-center gap-1 mt-1">
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs text-xs">{log.errorMessage}</p>
                          </TooltipContent>
                        </Tooltip>
                        <p className="text-xs text-destructive truncate">{log.errorMessage}</p>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-end whitespace-nowrap">
                    <p>{new Date(log.createdAt).toLocaleDateString()}</p>
                    <p>{new Date(log.createdAt).toLocaleTimeString()}</p>
                    {log.requestId && (
                      <p className="mt-1">#{log.requestId}</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 p-3 border-t">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            data-testid="button-prev-page"
          >
            {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            {t.emailLogs.previous}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t.emailLogs.page} {data.pagination.page} {t.emailLogs.of} {data.pagination.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage(p => p + 1)}
            data-testid="button-next-page"
          >
            {t.emailLogs.next}
            {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
