import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LogIn, Loader2 } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";
import logoSrc from "@/assets/logo.png";
import bgImage from "@/assets/login-bg.png";

export default function LoginPage() {
  usePageTitle("تسجيل الدخول");
  const { login } = useAuth();
  const { toast } = useToast();
  const { t, isRTL } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      toast({
        title: t.auth.loginFailed,
        description: err.message || t.auth.invalidCredentials,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative" dir={isRTL ? "rtl" : "ltr"}>
      <img
        src={bgImage}
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative z-10 min-h-screen flex flex-col md:flex-row-reverse">
        <div className="hidden md:flex md:flex-[7] items-end p-8">
          <div>
            <img src={logoSrc} alt={t.app.name} className="h-10 w-auto brightness-0 invert" />
            <p className="text-white/70 text-sm mt-2">{t.app.tagline}</p>
          </div>
        </div>

        <div className="flex-1 md:flex-[3] min-h-screen flex flex-col items-center justify-center p-6 md:p-8">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center space-y-4">
              <div className="flex flex-col items-center gap-4">
                <img src={logoSrc} alt={t.app.name} className="h-14 w-auto brightness-0 invert" />
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-white" data-testid="text-app-title">
                    {t.app.fullTitle}
                  </h1>
                  <p className="text-sm text-white/60 mt-1">
                    {t.app.tagline}
                  </p>
                </div>
              </div>
            </div>

            <div
              className="rounded-md p-6 space-y-4"
              style={{
                background: "rgba(255, 255, 255, 0.12)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
              }}
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4 mb-2">
                <h2 className="text-lg font-medium text-white">{t.auth.login}</h2>
                <LanguageToggle variant="glass" />
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white/90">{t.auth.email}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t.auth.emailPlaceholder}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-white/30"
                    data-testid="input-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-white/90">{t.auth.password}</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={t.auth.passwordPlaceholder}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-white/30"
                    data-testid="input-password"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-white/20 border border-white/25 text-white hover:bg-white/30"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      <span>{t.auth.login}</span>
                    </>
                  )}
                </Button>
              </form>
              <div className="pt-3 border-t border-white/10">
                <p className="text-xs text-white/40 text-center">
                  {t.app.copyright}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
