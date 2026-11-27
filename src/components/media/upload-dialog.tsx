"use client"

import { useEffect, useId, useRef, useState, type DragEvent } from "react"
import { UploadCloud, Upload, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { FolderNode } from "@/lib/media/folders"
import type { LibraryStats } from "@/lib/media/list"
import { fetchMultipartConfig } from "./multipart-upload"
import { isQuotaFull, QuotaBanner } from "./quota-banner"
import { TagField } from "./tag-field"
import { UploadItemRow } from "./upload-item-row"
import type { UploadQueue } from "./upload-queue"
import { useQueueSnapshot } from "./use-upload-queue"

export type UploadDialogProps = {
  open: boolean
  onClose: () => void
  queue: UploadQueue
  /** Contexte courant : espace et dossier préremplis (visibles, modifiables). */
  target: { spaceId: string | null; folderId: string | null }
  spaces: { id: string; name: string }[]
  folders: Pick<FolderNode, "id" | "name">[]
  isAdmin?: boolean
  stats?: Pick<LibraryStats, "percent"> | null
  /** Fichiers déposés sur la page, en attente de choix d'espace. */
  initialFiles?: File[]
  /** Filtre la liste sur les médias ajoutés. */
  onShowAdded?: (mediaIds: string[]) => void
}

const NONE = "__none__"
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function UploadDialog({
  open,
  onClose,
  queue,
  target,
  spaces,
  folders,
  isAdmin,
  stats,
  initialFiles,
  onShowAdded,
}: UploadDialogProps) {
  const t = useTranslations("library.upload")
  const items = useQueueSnapshot(queue)
  const inputRef = useRef<HTMLInputElement>(null)
  const ids = useId()
  const [staged, setStaged] = useState<File[]>([])
  const [spaceId, setSpaceId] = useState<string>(target.spaceId ?? "")
  const [folderId, setFolderId] = useState<string>(target.folderId ?? "")
  const [tags, setTags] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [largeEnabled, setLargeEnabled] = useState(false)

  useEffect(() => {
    if (!open) return
    setSpaceId(target.spaceId ?? "")
    setFolderId(target.folderId ?? "")
  }, [open, target.spaceId, target.folderId])

  useEffect(() => {
    if (!open) return
    let live = true
    void fetchMultipartConfig().then((c) => live && setLargeEnabled(Boolean(c?.enabled)))
    return () => {
      live = false
    }
  }, [open])

  useEffect(() => {
    if (open && initialFiles?.length) setStaged((s) => [...s, ...initialFiles])
  }, [open, initialFiles])

  const full = isQuotaFull(stats)
  const reason = full
    ? t("quotaFull")
    : staged.length === 0
      ? t("noFiles")
      : !spaceId
        ? t("spaceRequired")
        : undefined

  const addFiles = (list: FileList | File[] | null) => {
    if (full || !list) return
    setStaged((s) => [...s, ...Array.from(list)])
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    addFiles(e.dataTransfer.files)
  }
  const start = () => {
    if (reason) return
    queue.add(staged, {
      spaceId: spaceId === NONE ? null : spaceId,
      folderId: folderId || null,
      tags,
    })
    setStaged([])
  }

  const addedIds = items.filter((i) => i.status === "done" && i.mediaId).map((i) => i.mediaId as string)
  const busy = items.some((i) => ["queued", "hashing", "uploading"].includes(i.status))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{largeEnabled ? `${t("maxSize")}. ${t("largeHint")}` : t("maxSize")}</DialogDescription>
        </DialogHeader>
        <QuotaBanner stats={stats} />

        <div
          data-testid="drop-zone"
          aria-disabled={full || undefined}
          title={full ? t("quotaFull") : undefined}
          onDragOver={(e) => {
            e.preventDefault()
            if (!full) setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm ${
            full ? "opacity-50" : over ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p>{full ? t("quotaFull") : t("dropZone")}</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            data-testid="file-input"
            disabled={full}
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <Button variant="outline" size="sm" disabled={full} title={full ? t("quotaFull") : undefined} onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden />
            {t("browse")}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-space`}>{t("space")}</Label>
            <select id={`${ids}-space`} className={selectClass} value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              <option value="">{t("spacePlaceholder")}</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {isAdmin && <option value={NONE}>{t("spaceNone")}</option>}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-folder`}>{t("folder")}</Label>
            <select id={`${ids}-folder`} className={selectClass} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">{t("folderRoot")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-tags`}>{t("tags")}</Label>
          <TagField
            id={`${ids}-tags`}
            tags={tags}
            onAdd={(tag) => setTags((cur) => [...cur, tag])}
            onRemove={(tag) => setTags((cur) => cur.filter((x) => x !== tag))}
            placeholder={t("tagsHint")}
            removeLabel={(tag) => t("tagRemove", { tag })}
          />
        </div>

        {staged.length > 0 && (
          <section aria-label={t("stagedTitle")}>
            <h3 className="mb-1 text-sm font-medium">{t("stagedTitle")}</h3>
            <ul className="max-h-32 overflow-y-auto text-sm">
              {staged.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 py-0.5">
                  <span className="min-w-0 flex-1 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("removeStaged", { name: f.name })}
                    title={t("removeStaged", { name: f.name })}
                    onClick={() => setStaged(staged.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {items.length > 0 && (
          <section aria-label={t("queueTitle")}>
            <h3 className="mb-1 text-sm font-medium">{t("queueTitle")}</h3>
            <ul className="max-h-64 overflow-y-auto" aria-live="polite">
              {items.map((i) => (
                <UploadItemRow key={i.id} item={i} queue={queue} />
              ))}
            </ul>
          </section>
        )}

        <DialogFooter>
          {!busy && addedIds.length > 0 && onShowAdded && (
            <Button variant="outline" onClick={() => onShowAdded(addedIds)}>
              {t("showAdded")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <span title={reason}>
            <Button onClick={start} disabled={Boolean(reason)} aria-describedby={reason ? `${ids}-why` : undefined}>
              <Upload aria-hidden />
              {t("start")}
            </Button>
          </span>
          {reason && (
            <span id={`${ids}-why`} className="w-full text-right text-xs text-muted-foreground">
              {reason}
            </span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
