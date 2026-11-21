"use client"

import { useCallback, useEffect, useState } from "react"
import { Link } from "@/i18n/routing"
import { useTranslations } from "next-intl"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { UsageEntry } from "@/lib/media/usage-links"
import { LibraryErrorState } from "./media-states"

type Usages = { entries: UsageEntry[]; hiddenCount: number }

const VISIBLE_ROWS = 5

/** Emplacements d'un média (liens vers les contenus qui l'utilisent). */
export function UsageList({ mediaId }: { mediaId: string }) {
  const t = useTranslations("library")
  const [data, setData] = useState<Usages | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    setData(null)
    try {
      const res = await fetch(`/api/media/${mediaId}/usages`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as Usages)
    } catch {
      setFailed(true)
    }
  }, [mediaId])

  useEffect(() => {
    setExpanded(false)
    void load()
  }, [load])

  if (failed) return <LibraryErrorState onRetry={() => void load()} />
  if (!data) {
    return (
      <div className="space-y-2" role="status" aria-label={t("states.loading")}>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    )
  }
  if (data.entries.length === 0 && data.hiddenCount === 0) {
    return <p className="text-xs text-muted-foreground">{t("usage.empty")}</p>
  }

  const shown = expanded ? data.entries : data.entries.slice(0, VISIBLE_ROWS)
  const rest = data.entries.length - shown.length
  return (
    <ul className="space-y-1.5 text-sm">
      {shown.map((e) => (
        <li key={`${e.targetType}:${e.targetId}:${e.context ?? ""}`} className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">{t(`usage.kinds.${e.targetType}`)}</span>
          <Link href={e.href} className="min-w-0 truncate text-primary underline-offset-2 hover:underline" title={e.title}>
            {e.title}
          </Link>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setExpanded(true)}>
            {t("usage.more", { count: String(rest) })}
          </Button>
        </li>
      )}
      {data.hiddenCount > 0 && (
        <li className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t(data.hiddenCount === 1 ? "usage.hiddenOne" : "usage.hiddenMany", { count: String(data.hiddenCount) })}</span>
        </li>
      )}
    </ul>
  )
}
