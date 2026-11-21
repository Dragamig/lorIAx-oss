"use client"

import { AlertTriangle, HardDrive } from "lucide-react"
import { useTranslations } from "next-intl"
import type { LibraryStats } from "@/lib/media/list"

export const QUOTA_WARN_PERCENT = 80

export function isQuotaFull(stats: Pick<LibraryStats, "percent"> | null | undefined): boolean {
  return stats?.percent != null && stats.percent >= 100
}

/** Bandeau à 80 % (avertissement) et à 100 % (bloquant, lecture conservée). */
export function QuotaBanner({ stats }: { stats: Pick<LibraryStats, "percent"> | null | undefined }) {
  const t = useTranslations("library.quota")
  const percent = stats?.percent
  if (percent == null || percent < QUOTA_WARN_PERCENT) return null
  const full = percent >= 100
  const Icon = full ? AlertTriangle : HardDrive
  return (
    <div
      role={full ? "alert" : "status"}
      data-testid="quota-banner"
      className={
        full
          ? "flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          : "flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-sm text-foreground"
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{full ? t("full") : t("warn", { percent: Math.round(percent) })}</span>
    </div>
  )
}
