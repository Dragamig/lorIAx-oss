"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type TemplateBadgeKind = "lorIAx" | "org" | "hidden";

const KEY: Record<TemplateBadgeKind, string> = {
  lorIAx: "badgeLorIAx",
  org: "badgeOrg",
  hidden: "badgeHidden",
};

const STYLE: Record<TemplateBadgeKind, string> = {
  lorIAx: "bg-primary/10 text-primary",
  org: "bg-secondary text-secondary-foreground",
  hidden: "border border-border bg-transparent text-muted-foreground",
};

/** Pastille d'origine ou d'état d'un modèle. */
export function TemplateBadge({ kind, className }: { kind: TemplateBadgeKind; className?: string }) {
  const t = useTranslations("presentations.templates");
  return (
    <span
      data-template-badge={kind}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold",
        STYLE[kind],
        className
      )}
    >
      {t(KEY[kind])}
    </span>
  );
}
