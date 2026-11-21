"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import type { BatchItemResult } from "@/lib/media/batch"
import { UsageList } from "./usage-list"

type Summary = {
  perMedia: Record<string, { total: number; visible: number; hidden: number }>
  trashRetentionDays?: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: string[]
  /** Au moins un média est partagé publiquement. */
  publicShared?: boolean
  /** Appelé après une mise à la corbeille (totale ou partielle) ou son annulation. */
  /**
   * Confie annonce et annulation à l'appelant (pile Ctrl+Z de la page) : le dialogue
   * ne pose alors aucun toast. Sans lui, il annonce et annule lui-même.
   */
  onTrashed?: (ids: string[], results: BatchItemResult[]) => void
  onDone: (result: { trashedIds: string[]; results: BatchItemResult[] }) => void
}

const DEFAULT_RETENTION_DAYS = 30

async function batch(action: "trash" | "restore", ids: string[]): Promise<BatchItemResult[]> {
  const res = await fetch("/api/media/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ids }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return ((await res.json()) as { results?: BatchItemResult[] }).results ?? []
}

/** Confirmation de mise à la corbeille : n'est jamais bloquée par un usage (B56). */
export function TrashDialog({ open, onOpenChange, ids, publicShared, onDone, onTrashed }: Props) {
  const t = useTranslations("library")
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryFailed, setSummaryFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const key = ids.join(",")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSummary(null)
    setSummaryFailed(false)
    fetch("/api/media/usages-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Summary>
      })
      .then((s) => !cancelled && setSummary(s))
      .catch(() => !cancelled && setSummaryFailed(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])

  const single = ids.length === 1
  const usedCount = summary ? Object.values(summary.perMedia).filter((m) => m.total > 0).length : 0
  const days = summary?.trashRetentionDays ?? DEFAULT_RETENTION_DAYS

  const confirm = async () => {
    setBusy(true)
    try {
      const results = await batch("trash", ids)
      const done = results.filter((r) => r.ok)
      const failedCount = results.length - done.length
      const trashedIds = done.filter((r) => r.error !== "already").map((r) => r.id)
      if (onTrashed) {
        onTrashed(ids, results)
        onOpenChange(false)
        onDone({ trashedIds, results })
        return
      }
      const undo = {
        label: t("actions.undo"),
        onClick: () =>
          void batch("restore", trashedIds)
            .then((r) => {
              toast.success(t("trash.restored", { count: String(r.filter((x) => x.ok).length) }))
            })
            .catch(() => toast.error(t("trash.restoreFailed")))
            .finally(() => onDone({ trashedIds: [], results: [] })),
      }
      if (failedCount > 0) {
        toast.error(t("trash.partial", { ok: String(done.length), total: String(ids.length), failed: String(failedCount) }), {
          ...(trashedIds.length > 0 ? { action: undo } : {}),
          // role="alert" porté par le toast d'erreur
        })
      } else {
        toast.success(t(done.length === 1 ? "trash.doneOne" : "trash.doneMany", { count: String(done.length) }), {
          ...(trashedIds.length > 0 ? { action: undo } : {}),
        })
      }
      onOpenChange(false)
      onDone({ trashedIds, results })
    } catch {
      toast.error(t("trash.failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("trash.title")}</DialogTitle>
          <DialogDescription>{t("trash.retention", { days: String(days) })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {publicShared && <p className="text-amber-600 dark:text-amber-400">{t("trash.publicShared")}</p>}
          {summaryFailed ? (
            <p role="alert" className="text-xs text-muted-foreground">
              {t("trash.summaryError")}
            </p>
          ) : !summary ? (
            <div role="status" aria-label={t("states.loading")}>
              <Skeleton className="h-5 w-3/4" />
            </div>
          ) : single ? (
            usedCount > 0 && (
              <div className="space-y-2">
                <p>{t("trash.usedHeading")}</p>
                <UsageList mediaId={ids[0]} />
              </div>
            )
          ) : (
            <p>{t("trash.batchUsed", { used: String(usedCount), total: String(ids.length) })}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("trash.cancel")}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>
            {t("trash.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
