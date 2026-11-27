"use client"

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { createUploadQueue, type UploadItem, type UploadQueue, type UploadQueueOptions } from "./upload-queue"

export function useUploadQueue(opts?: UploadQueueOptions): UploadQueue {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createUploadQueue(opts), [])
}

const EMPTY: UploadItem[] = []

export function useQueueSnapshot(queue: UploadQueue): UploadItem[] {
  return useSyncExternalStore(queue.subscribe, queue.snapshot, () => EMPTY)
}

const BUSY = new Set(["queued", "hashing", "uploading"])

/**
 * Un seul toast de fin de lot (« 4 fichiers ajoutés »), « Annuler » met les médias
 * téléversés du lot à la corbeille. Appelle onMutated pour rafraîchir la liste.
 */
export function useBatchToast(queue: UploadQueue, onMutated?: () => void, onUndone?: (ids: string[]) => void) {
  const t = useTranslations("library")
  // Refs : le rappel change à chaque rendu et ne doit ni réabonner ni vider l'historique des lots déjà annoncés.
  const onMutatedRef = useRef(onMutated)
  const onUndoneRef = useRef(onUndone)
  const reportedRef = useRef(new Set<string>())
  useEffect(() => {
    onMutatedRef.current = onMutated
    onUndoneRef.current = onUndone
  })
  useEffect(() => {
    const reported = reportedRef.current
    const unsubscribe = queue.subscribe(() => {
      const items = queue.snapshot()
      // Envoi par parts interrompu ou refusé : un toast d'erreur, une seule fois.
      for (const i of items) {
        if (i.large && i.status === "error" && i.error && !reported.has(`err:${i.id}`)) {
          reported.add(`err:${i.id}`)
          toast.error(
            i.error.kind === "interrupted"
              ? t("upload.large.toastInterrupted", { name: i.name })
              : i.error.kind === "too_large"
                ? t("upload.errors.too_large", { limit: String(i.error.limitMb ?? 200) })
                : t(`upload.errors.${i.error.kind}`, { ext: i.error.ext ?? "" }),
          )
        } else if (i.status !== "error") reported.delete(`err:${i.id}`)
      }
      const busy = items.some((i) => BUSY.has(i.status))
      if (!busy) {
        const added = items.filter((i) => i.status === "done" && i.mediaId && !reported.has(i.id))
        added.forEach((i) => reported.add(i.id))
        if (added.length > 0) {
          onMutatedRef.current?.()
          const uploaded = added.filter((i) => !i.reused).map((i) => i.mediaId as string)
          const message = added.length === 1 ? t("upload.doneOne") : t("upload.doneMany", { count: String(added.length) })
          toast.success(message, {
            action:
              uploaded.length > 0
                ? {
                    label: t("actions.undo"),
                    onClick: () => {
                      void fetch("/api/media/batch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "trash", ids: uploaded }),
                      })
                        .then((r) => {
                          if (r.ok) {
                            toast.success(t("upload.undone"))
                            onUndoneRef.current?.(uploaded)
                          }
                          else toast.error(t("upload.undoFailed"))
                          onMutatedRef.current?.()
                        })
                        .catch(() => toast.error(t("upload.undoFailed")))
                    },
                  }
                : undefined,
          })
        }
      }
    })
    return unsubscribe
  }, [queue, t])
}
