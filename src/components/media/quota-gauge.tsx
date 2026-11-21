"use client"

import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { LibraryStats } from "@/lib/media/list"

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const

function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, bytes)
  let i = 0
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024
    i++
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[i],
    unitDisplay: "short",
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(value)
}

type Props = { stats: Pick<LibraryStats, "usedBytes" | "limitBytes" | "percent"> }

export function QuotaGauge({ stats }: Props) {
  const t = useTranslations("library.quota")
  const locale = useLocale()
  const { usedBytes, limitBytes } = stats
  const percent = limitBytes === null ? null : Math.min(100, Math.max(0, stats.percent ?? 0))
  const used = formatBytes(usedBytes, locale)

  return (
    <div className="space-y-1.5 border-t border-border p-3 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{t("label")}</span>
        <span className="text-muted-foreground">
          {limitBytes === null ? `${used} · ${t("unlimited")}` : t("usage", { used, limit: formatBytes(limitBytes, locale) })}
        </span>
      </div>
      {percent !== null && (
        <div
          role="progressbar"
          aria-label={t("label")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn("h-full rounded-full", percent >= 90 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="text-muted-foreground">{t("note")}</p>
    </div>
  )
}
