import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useMutation } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, KeyRound, Eye, EyeOff } from "lucide-react";

export default function ChangePasswordPage() {
  const { t } = useLang();
  const cp = t.changePassword;
  usePageTitle(cp.title);
  const { token } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: cp.success });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: Error) => {
      const msg = err.message === "Current password is incorrect" ? cp.wrongPassword : err.message;
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: t.common.error, description: cp.allFieldsRequired, variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: t.common.error, description: cp.minLength, variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t.common.error, description: cp.mismatch, variant: "destructive" });
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="flex flex-col h-full">
      <Topbar title={cp.title} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                {cp.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <Label>{cp.currentPassword}</Label>
                  <div className="relative">
                    <Input
                      type={showCurrent ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      data-testid="input-current-password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 h-full ltr:right-0 rtl:left-0"
                      onClick={() => setShowCurrent(!showCurrent)}
                      tabIndex={-1}
                    >
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>{cp.newPassword}</Label>
                  <div className="relative">
                    <Input
                      type={showNew ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      data-testid="input-new-password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 h-full ltr:right-0 rtl:left-0"
                      onClick={() => setShowNew(!showNew)}
                      tabIndex={-1}
                    >
                      {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{cp.minLength}</p>
                </div>
                <div className="space-y-1">
                  <Label>{cp.confirmPassword}</Label>
                  <div className="relative">
                    <Input
                      type={showConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      data-testid="input-confirm-password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 h-full ltr:right-0 rtl:left-0"
                      onClick={() => setShowConfirm(!showConfirm)}
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="button-change-password">
                  {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2 rtl:mr-0 rtl:ml-2" />}
                  {cp.submit}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
