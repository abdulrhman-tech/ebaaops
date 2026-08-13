import { useLang } from "@/lib/i18n";
import { Languages } from "lucide-react";

interface LanguageToggleProps {
  variant?: "default" | "glass";
}

export function LanguageToggle({ variant = "default" }: LanguageToggleProps) {
  const { lang, setLang } = useLang();

  const isGlass = variant === "glass";

  return (
    <button
      onClick={() => setLang(lang === "ar" ? "en" : "ar")}
      className={`
        relative inline-flex items-center gap-2 px-3 h-8 rounded-full text-[11px] font-medium
        transition-all duration-300 ease-in-out select-none
        ${isGlass
          ? "bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 backdrop-blur-md shadow-lg"
          : "bg-muted border border-border text-muted-foreground hover-elevate shadow-sm"
        }
      `}
      data-testid="button-language-toggle"
    >
      <Languages className={`w-3.5 h-3.5 ${isGlass ? "text-white/70" : "text-muted-foreground/70"}`} />
      
      <div className="relative flex items-center overflow-hidden h-full min-w-[45px] justify-center">
        <span
          className={`
            transition-all duration-500 ease-out
            ${lang === "ar" 
              ? "translate-y-0 opacity-100" 
              : "-translate-y-full opacity-0 absolute"
            }
            ${isGlass ? "text-white font-bold" : "text-foreground font-bold"}
          `}
        >
          العربية
        </span>
        <span
          className={`
            transition-all duration-500 ease-out
            ${lang === "en" 
              ? "translate-y-0 opacity-100" 
              : "translate-y-full opacity-0 absolute"
            }
            ${isGlass ? "text-white font-bold" : "text-foreground font-bold"}
          `}
        >
          English
        </span>
      </div>

      <div className={`
        flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold
        ${isGlass ? "bg-white/20 text-white" : "bg-primary/10 text-primary"}
      `}>
        {lang === "ar" ? "EN" : "ع"}
      </div>
    </button>
  );
}
