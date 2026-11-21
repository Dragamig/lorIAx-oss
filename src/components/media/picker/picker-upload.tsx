"use client"

import { useId, useMemo, useRef, useState, type DragEvent } from "react"
import { UploadCloud } from "lucide-react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import type { MediaKind } from "@/lib/db/schema"
import { kindFromMime } from "@/lib/media/kind"
import { ActionButton } from "../action-button"
import { isQuotaFull, QuotaBanner } from "../quota-banner"
import { UploadItemRow } from "../upload-item-row"
import type { UploadQueue } from "../upload-queue"
import { useQueueSnapshot } from "../use-upload-queue"

const BUSY = new Set(["queued", "hashing", "uploading"])
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

type Props = {
  accept?: MediaKind[]
  mode: "single" | "multiple"
  /** Espace du contexte (document, base, projet) ; sans lui, l'utilisateur en choisit un. */
  spaceId?: string | null
  /** File d'envoi portée par le corps du sélecteur : elle survit au changement d'onglet. */
  queue: UploadQueue
}

/** Onglet Téléverser : dépôt ou parcours, affichage de la file de la 1b. */
export function PickerUpload({ accept, mode, spaceId, queue }: Props) {
  const t = useTranslations("library.upload")
  const tp = useTranslations("library.picker")
  const ids = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const items = useQueueSnapshot(queue)
  const stats = useSWR<{ percent: number | null }>("/api/media/stats", fetchJson, { revalidateOnFocus: false })
  const spaceData = useSWR<{ id: string; name: string }[]>(spaceId ? null : "/api/spaces", fetchJson, {
    revalidateOnFocus: false,
  })
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)
  const [chosenSpace, setChosenSpace] = useState<string>("")

  const spaces = useMemo(() => (Array.isArray(spaceData.data) ? spaceData.data : []), [spaceData.data])
  const targetSpace = spaceId || chosenSpace || spaces[0]?.id || ""
  const full = isQuotaFull(stats.data)
  const noSpace = !spaceId && !spaceData.isLoading && spaces.length === 0
  const locked = accept && accept.length > 0 ? accept : undefined
  const imageOnly = !!locked && locked.every((k) => k === "image")

  const disabledReason = full ? t("quotaFull") : noSpace ? tp("noWritableSpace") : !targetSpace ? tp("spaceLoading") : undefined

  const accepts = (file: File) => !locked || locked.includes(kindFromMime(file.type, file.name))
  const addFiles = (list: FileList | File[] | null) => {
    if (!list || disabledReason) return
    const files = Array.from(list)
    const ok = files.filter(accepts)
    setRejected(ok.length < files.length ? (imageOnly ? tp("onlyImages") : tp("notAccepted")) : null)
    if (ok.length > 0) queue.add(ok, { spaceId: targetSpace, folderId: null, tags: [] })
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    addFiles(e.dataTransfer.files)
  }

  const busy = items.some((i) => BUSY.has(i.status))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <QuotaBanner stats={stats.data} />
      <div
        data-testid="picker-drop-zone"
        aria-disabled={disabledReason ? true : undefined}
        title={disabledReason}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabledReason) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm ${
          disabledReason ? "opacity-50" : over ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p>{disabledReason ?? t("dropZone")}</p>
        <input
          ref={inputRef}
          type="file"
          multiple={mode === "multiple"}
          hidden
          data-testid="picker-file-input"
          accept={imageOnly ? "image/*" : undefined}
          disabled={Boolean(disabledReason)}
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ""
          }}
        />
        <ActionButton
          id="upload"
          variant="outline"
          showLabel
          disabledReason={disabledReason}
          onAction={() => inputRef.current?.click()}
        />
        <p className="text-xs text-muted-foreground">{t("maxSize")}</p>
      </div>

      {!spaceId && spaces.length > 0 ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-space`} className="text-sm">
            {t("space")}
          </label>
          <select
            id={`${ids}-space`}
            className={selectClass}
            value={targetSpace}
            disabled={busy}
            onChange={(e) => setChosenSpace(e.target.value)}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {rejected ? (
        <p role="alert" className="text-sm text-destructive">
          {rejected}
        </p>
      ) : null}

      {items.length > 0 ? (
        <section aria-label={t("queueTitle")}>
          <h3 className="mb-1 text-sm font-medium">{t("queueTitle")}</h3>
          <ul aria-live="polite">
            {items.map((i) => (
              <UploadItemRow key={i.id} item={i} queue={queue} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
