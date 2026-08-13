import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLang } from "@/lib/i18n";

interface KPITooltipProps {
  title: string;
  definition: string;
  calculation: string;
  importance: string;
  riskNote: string;
}

export function KPITooltip({ title, definition, calculation, importance, riskNote }: KPITooltipProps) {
  const { isRTL } = useLang();
  const labels = isRTL
    ? { calc: "طريقة الحساب", why: "لماذا يهم", risk: "مؤشر خطر" }
    : { calc: "How it's calculated", why: "Why it matters", risk: "Risk Indicator" };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="inline-flex items-center justify-center rounded-full w-4 h-4 text-muted-foreground hover:text-primary transition-colors focus:outline-none ml-1.5" data-testid="kpi-tooltip-trigger">
            <Info className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent 
          className="w-[280px] p-4 bg-popover/95 backdrop-blur-sm border shadow-xl rounded-lg" 
          side="top"
          align="start"
          data-testid="kpi-tooltip-content"
        >
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm text-primary mb-1">{title}</h4>
              <p className="text-xs leading-relaxed text-foreground">{definition}</p>
            </div>
            
            {calculation && (
              <div className="pt-2 border-t border-border/50">
                <h5 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{labels.calc}</h5>
                <p className="text-[11px] leading-relaxed font-mono bg-muted/50 p-1.5 rounded text-foreground/80">{calculation}</p>
              </div>
            )}
            
            <div className="pt-2 border-t border-border/50">
              <h5 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{labels.why}</h5>
              <p className="text-[11px] leading-relaxed text-foreground/80 italic">{importance}</p>
            </div>
            
            {riskNote && (
              <div className="pt-2 border-t border-border/50">
                <h5 className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1">{labels.risk}</h5>
                <p className="text-[11px] leading-relaxed text-red-700/90 dark:text-red-300/90">{riskNote}</p>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
