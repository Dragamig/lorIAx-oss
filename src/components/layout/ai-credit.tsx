import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Attribution line, intentionally identical in every locale (not translated).
export const AI_CREDIT = "Créé par Studio Dragamig avec l'aide de Claude d'Anthropic";

export function AiCredit({ className }: { className?: string }) {
  const t = useTranslations("shell");
  return (
    <p data-testid="ai-credit" className={cn("text-xs text-muted-foreground", className)}>
      {t("aiCredit")}
    </p>
  );
}
