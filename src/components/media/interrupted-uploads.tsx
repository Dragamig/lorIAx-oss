"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ActionButton } from "./action-button"
import { formatMediaSize } from "./media-format"
import { discardLargeUpload, fingerprint, listStoredSessions, type StoredSession } from "./multipart-upload"
import type { UploadQueue } from "./upload-queue"
import { useQueueSnapshot } from "./use-upload-queue"

/**
 * Envois par parts mémorisés dans le navigateur mais absents de la file (page
 * rechargée) : bandeau « Envoi interrompu », reprise en re-sélectionnant le fichier.
 */
export function InterruptedUploads({ queue, userId }: { queue: UploadQueue; userId?: string }) {
  const tl = useTranslations("library.upload.large")
  const locale = useLocale()
  const items = useQueueSnapshot(queue)
  const [tick, setTick] = useState(0)
  const [picking, setPicking] = useState<StoredSession | null>(null)
  const [mismatch, setMismatch] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Relit le stockage au montage et quand la file change (fin d'un envoi, annulation).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stored = useMemo(() => (userId ? listStoredSessions({ userId }) : []), [userId, items, tick])
  const inQueue = useMemo(() => new Set(items.filter((i) => i.status !== "cancelled" && i.resumeKey).map((i) => i.resumeKey)), [items])
  const pending = userId ? stored.filter((s) => !inQueue.has(fingerprint(userId, s))) : []
  useEffect(() => {
    if (picking) setMismatch(false)
  }, [picking])

  if (pending.length === 0 && !picking) return null
  const pctOf = (s: StoredSession) => Math.max(1, Math.round((s.partsDone / s.partCount) * 100))

  const onFile = (file: File | undefined) => {
    if (!file || !picking) return
    if (file.name !== picking.name || file.size !== picking.size || file.lastModified !== picking.lastModified) {
      setMismatch(true)
      return
    }
    queue.add([file], { spaceId: picking.target.spaceId, folderId: picking.target.folderId ?? null, tags: [] })
    toast(tl("toastResumedAt", { part: String(picking.partsDone + 1), total: String(picking.partCount) }))
    setPicking(null)
  }

  return (
    <>
      {pending.map((s) => (
        <div
          key={s.uploadId}
          role="status"
          className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <p className="min-w-0 flex-1">
            <b>{tl("bannerTitle")}</b> : {tl("bannerBody", { name: s.name, pct: String(pctOf(s)) })}
          </p>
          <ActionButton id="resumeInterrupted" variant="default" size="sm" showLabel onAction={() => setPicking(s)} />
          <ActionButton
            id="abandonInterrupted"
            variant="outline"
            size="sm"
            showLabel
            onAction={() => {
              void discardLargeUpload(s, { userId }).then(() => {
                setTick((n) => n + 1)
                toast(tl("toastAbandoned", { name: s.name }))
              })
            }}
          />
        </div>
      ))}
      <Dialog open={Boolean(picking)} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tl("resumeTitle")}</DialogTitle>
            <DialogDescription>
              {picking ? tl("resumeBody", { name: picking.name, size: formatMediaSize(picking.size, locale), pct: String(pctOf(picking)) }) : ""}
            </DialogDescription>
          </DialogHeader>
          <input ref={inputRef} type="file" accept="video/*" hidden data-testid="resume-file-input" onChange={(e) => {
            onFile(e.target.files?.[0])
            e.target.value = ""
          }} />
          {mismatch && picking && (
            <p role="alert" className="text-sm text-destructive">
              {tl("mismatch", { name: picking.name, size: formatMediaSize(picking.size, locale) })}
            </p>
          )}
          <DialogFooter>
            <ActionButton id="pickResumeFile" variant="default" size="default" showLabel onAction={() => inputRef.current?.click()} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
