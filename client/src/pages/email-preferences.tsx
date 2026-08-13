import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, FileText, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export default function EmailPreferencesPage() {
  usePageTitle("تفضيلات البريد");
  const { t } = useLang();
  const { user } = useAuth();
  const { toast } = useToast();

  const token = localStorage.getItem("token");
  const { data: prefs, isLoading } = useQuery<any>({
    queryKey: ["/api/email-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/email-preferences", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (newPrefs: any) => {
      const res = await fetch("/api/email-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(newPrefs),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-preferences"] });
      toast({ title: t.emailPreferences.saved });
    },
    onError: () => {
      toast({ title: t.emailPreferences.saveFailed, variant: "destructive" });
    },
  });

  const PREF_KEYS = [
    "requestCreated", "requestApproved", "requestRejected",
    "requestFinalApproved", "requestEdited", "stockReleaseRequested",
    "stockReleaseApproved", "stockReleaseRejected", "stockReleaseFinalApproved",
  ];

  const handleToggle = (key: string, value: boolean) => {
    if (!prefs) return;
    const payload: Record<string, boolean> = {};
    for (const k of PREF_KEYS) {
      payload[k] = k === key ? value : (prefs[k] ?? true);
    }
    mutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const requestPrefs = [
    { key: "requestCreated", label: t.emailPreferences.requestCreated },
    { key: "requestApproved", label: t.emailPreferences.requestApproved },
    { key: "requestRejected", label: t.emailPreferences.requestRejected },
    { key: "requestFinalApproved", label: t.emailPreferences.requestFinalApproved },
    { key: "requestEdited", label: t.emailPreferences.requestEdited },
  ];

  const stockPrefs = [
    { key: "stockReleaseRequested", label: t.emailPreferences.stockReleaseRequested },
    { key: "stockReleaseApproved", label: t.emailPreferences.stockReleaseApproved },
    { key: "stockReleaseRejected", label: t.emailPreferences.stockReleaseRejected },
    { key: "stockReleaseFinalApproved", label: t.emailPreferences.stockReleaseFinalApproved },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b">
        <Mail className="w-5 h-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-email-prefs-title">{t.emailPreferences.title}</h1>
          <p className="text-xs text-muted-foreground">{t.emailPreferences.subtitle}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t.emailPreferences.requestEvents}</h2>
          </div>
          <div className="space-y-3">
            {requestPrefs.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-4" data-testid={`pref-${key}`}>
                <Label htmlFor={key} className="text-sm cursor-pointer flex-1">
                  {label}
                </Label>
                <Switch
                  id={key}
                  checked={prefs?.[key] ?? true}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  disabled={mutation.isPending}
                  data-testid={`switch-${key}`}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t.emailPreferences.stockEvents}</h2>
          </div>
          <div className="space-y-3">
            {stockPrefs.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-4" data-testid={`pref-${key}`}>
                <Label htmlFor={key} className="text-sm cursor-pointer flex-1">
                  {label}
                </Label>
                <Switch
                  id={key}
                  checked={prefs?.[key] ?? true}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  disabled={mutation.isPending}
                  data-testid={`switch-${key}`}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
