"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { UploadItemRow } from "./upload-item-row"
import type { UploadQueue } from "./upload-queue"
import { useBatchToast, useQueueSnapshot } from "./use-upload-queue"

type Props = {
  queue: UploadQueue
  /** Masqué quand le dialogue est ouvert (il affiche déjà la file). */
  hidden?: boolean
  onOpen: () => void
  onMutated?: () => void
}

/** Suivi flottant réduit : actif, en erreur ou en attente de choix de doublon. */
export function UploadTray({ queue, hidden, onOpen, onMutated }: Props) {
  const t = useTranslations("library.upload")
  const items = useQueueSnapshot(queue)
  useBatchToast(queue, onMutated)

  const visible = items.filter((i) => i.status !== "done" && i.status !== "cancelled")
  const doneCount = items.filter((i) => i.status === "done").length

  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
      {!hidden && visible.length > 0 && (
        <div className="pointer-events-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {t("trayTitle", { done: String(doneCount), total: String(items.length) })}
            </span>
            <Button size="sm" variant="outline" onClick={onOpen}>
              {t("trayOpen")}
            </Button>
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {visible.slice(0, 5).map((i) => (
              <UploadItemRow key={i.id} item={i} queue={queue} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
