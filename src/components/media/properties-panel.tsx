"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { BatchItemResult } from "@/lib/media/batch"
import type { FolderNode } from "@/lib/media/folders"
import type { MediaDetail, MediaPatch } from "@/lib/media/metadata"
import { ActionButton } from "./action-button"
import { folderPath } from "./filter-bar"
import { formatMediaDate, formatMediaSize } from "./media-format"
import { LibraryErrorState } from "./media-states"
import { KIND_ICONS } from "./media-kind-icon"
import { TagField } from "./tag-field"
import { SpaceDialog } from "./space-dialog"
import { TrashDialog } from "./trash-dialog"
import type { UndoStack } from "./use-undo-stack"
import { UsageList } from "./usage-list"

type Props = {
  /** Média ouvert ; `null` : rien n'est rendu et la colonne reste repliée. */
  mediaId: string | null
  onClose: () => void
  onMutated: () => void
  /** Emplacement de la section « Utilisé dans » (tâche 19). */
  usageSlot?: ReactNode
  /** Ouvre l'aperçu agrandi (porté par la page, qui connaît la liste courante). */
  onPreview?: (id: string) => void
  /** Espaces proposés par « Changer d'espace ». */
  spaces?: { id: string; name: string }[]
  /** Pile de Ctrl+Z de la page, pour annuler un changement d'espace. */
  undo?: UndoStack
  /** Confie à la page l'annonce et l'annulation d'une mise à la corbeille (pile Ctrl+Z). */
  onTrashed?: (ids: string[], results: BatchItemResult[]) => void
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

function TextField({
  id,
  label,
  value,
  multiline,
  disabledReason,
  error,
  syncKey,
  onCommit,
}: {
  id: string
  label: string
  value: string
  multiline?: boolean
  disabledReason?: string
  error?: string
  syncKey: number
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value, syncKey])
  const common = {
    id,
    value: draft,
    disabled: Boolean(disabledReason),
    title: disabledReason,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => onCommit(draft),
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea rows={3} {...common} />
      ) : (
        <Input
          {...common}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onCommit(draft)
            }
          }}
        />
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right" title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  )
}

export function PropertiesPanel({ mediaId, onClose, onMutated, usageSlot, onPreview, spaces = [], undo, onTrashed }: Props) {
  const t = useTranslations("library")
  const locale = useLocale()
  const ids = useId()
  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [filenameError, setFilenameError] = useState<string | undefined>()
  const [syncKey, setSyncKey] = useState(0)
  const [trashOpen, setTrashOpen] = useState(false)
  const [spaceOpen, setSpaceOpen] = useState(false)

  // Média actuellement ouvert : toute réponse d'un autre média (clic A puis B) est ignorée.
  const currentId = useRef(mediaId)
  useEffect(() => {
    currentId.current = mediaId
  }, [mediaId])

  const load = useCallback(async () => {
    if (!mediaId) return
    setLoadFailed(false)
    try {
      const res = await request(`/api/media/${mediaId}/meta`)
      const media = ((await res.json()) as { media: MediaDetail }).media
      if (currentId.current === mediaId) setDetail(media)
    } catch {
      if (currentId.current === mediaId) setLoadFailed(true)
    }
  }, [mediaId])

  useEffect(() => {
    setDetail(null)
    setFilenameError(undefined)
    void load()
  }, [load])

  useEffect(() => {
    if (!mediaId) return
    request("/api/media/folders")
      .then((r) => r.json())
      .then((d: { folders: FolderNode[] }) => setFolders(d.folders ?? []))
      .catch(() => setFolders([]))
  }, [mediaId])

  /** PATCH d'un média précis (l'annulation vise le média d'origine, même si le panneau a changé). */
  const patchFor = useCallback(
    async (id: string, body: MediaPatch): Promise<MediaDetail | null> => {
      try {
        const res = await request(`/api/media/${id}/meta`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const next = ((await res.json()) as { media: MediaDetail }).media
        if (currentId.current === id) setDetail(next)
        onMutated()
        return next
      } catch {
        toast.error(t("props.saveError"))
        if (currentId.current === id) setSyncKey((k) => k + 1)
        return null
      }
    },
    [onMutated, t],
  )

  /** Enregistre, annonce par un toast bref et propose d'annuler (pile Ctrl+Z comprise). */
  const save = useCallback(
    async (body: MediaPatch, revert: MediaPatch, message: string) => {
      if (!mediaId) return
      const next = await patchFor(mediaId, body)
      if (!next) return
      const entry = undo?.push(async () => void (await patchFor(mediaId, revert)), [mediaId])
      const toastId = toast.success(message, {
        action: {
          label: t("actions.undo"),
          onClick: () => {
            if (!entry || !undo) return void patchFor(mediaId, revert)
            void undo.tryRun(entry).then((ran) => {
              if (!ran) toast.info(t("bulk.undoStale"))
            })
          },
        },
      })
      if (entry) entry.dismiss = () => toast.dismiss(toastId)
    },
    [mediaId, patchFor, t, undo],
  )

  const tagLabels = useMemo(() => (detail?.tags ?? []).map((x) => x.label), [detail])
  const path = useMemo(
    () =>
      folderPath(folders, detail?.folderId ?? undefined)
        .map((f) => f.name)
        .join(" / "),
    [folders, detail?.folderId],
  )

  if (!mediaId) return null

  const header = (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <h2 className="text-sm font-semibold">{t("props.title")}</h2>
      <ActionButton id="closeProps" onAction={onClose} />
    </div>
  )

  if (loadFailed) {
    return (
      <div>
        {header}
        <LibraryErrorState onRetry={() => void load()} />
      </div>
    )
  }
  if (!detail) {
    return (
      <div>
        {header}
        <div className="space-y-3 p-3" role="status" aria-label={t("states.loading")}>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    )
  }

  const reason = detail.canWrite ? undefined : t("props.readOnlyReason")
  const Icon = KIND_ICONS[detail.kind]
  const absoluteUrl = `${window.location.origin}${detail.url}`
  const dims = detail.width && detail.height ? `${detail.width} × ${detail.height}` : null

  const saveText = (field: "title" | "altText" | "description", label: string, current: string | null) => (next: string) => {
    const value = next.trim() === "" ? null : next
    if (value === (current ?? null)) return
    void save({ [field]: value }, { [field]: current }, t("props.saved", { field: label }))
  }

  const commitFilename = (next: string) => {
    if (next.trim() === "") {
      setFilenameError(t("props.filenameRequired"))
      return
    }
    setFilenameError(undefined)
    if (next === detail.filename) return
    void save({ filename: next }, { filename: detail.filename }, t("props.saved", { field: t("props.fieldFilename") }))
  }

  const setTags = (next: string[], message: string) => void save({ tags: next }, { tags: tagLabels }, message)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl)
      toast.success(t("props.linkCopied"))
    } catch {
      toast.error(t("props.copyFailed"))
    }
  }

  const download = () => {
    const a = document.createElement("a")
    a.href = detail.url
    a.download = detail.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="flex flex-col">
      {header}
      <div className="flex h-44 items-center justify-center overflow-hidden bg-muted">
        {detail.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={detail.url} alt={detail.altText ?? ""} className="max-h-full max-w-full object-contain" />
        ) : (
          <Icon className="h-14 w-14 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {onPreview && <ActionButton id="preview" onAction={() => onPreview(detail.id)} />}
        <ActionButton id="download" onAction={download} />
        <ActionButton id="copyLink" onAction={() => void copyLink()} />
        {detail.canChangeSpace && <ActionButton id="changeSpace" onAction={() => setSpaceOpen(true)} />}
        <ActionButton
          id="trash"
          onAction={() => setTrashOpen(true)}
          disabledReason={reason}
        />
        {!detail.canWrite && (
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={reason}>
            {t("props.readOnly")}
          </span>
        )}
      </div>

      <section aria-label={t("props.sectionInfo")} className="space-y-3 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("props.sectionInfo")}</h3>
        <TextField
          id={`${ids}-title`}
          label={t("props.fieldTitle")}
          value={detail.title ?? ""}
          disabledReason={reason}
          syncKey={syncKey}
          onCommit={saveText("title", t("props.fieldTitle"), detail.title)}
        />
        <TextField
          id={`${ids}-filename`}
          label={t("props.fieldFilename")}
          value={detail.filename}
          disabledReason={reason}
          error={filenameError}
          syncKey={syncKey}
          onCommit={commitFilename}
        />
        <TextField
          id={`${ids}-alt`}
          label={t("props.fieldAlt")}
          value={detail.altText ?? ""}
          disabledReason={reason}
          syncKey={syncKey}
          onCommit={saveText("altText", t("props.fieldAlt"), detail.altText)}
        />
        <TextField
          id={`${ids}-description`}
          label={t("props.fieldDescription")}
          multiline
          value={detail.description ?? ""}
          disabledReason={reason}
          syncKey={syncKey}
          onCommit={saveText("description", t("props.fieldDescription"), detail.description)}
        />

        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-tags`}>{t("props.fieldTags")}</Label>
          <TagField
            id={`${ids}-tags`}
            tags={tagLabels}
            inputLabel={t("props.tagAddField")}
            placeholder={t("props.tagsHint")}
            removeLabel={(tag) => t("props.tagRemove", { tag })}
            disabledReason={reason}
            onAdd={(tag) => setTags([...tagLabels, tag], t("props.tagAdded", { tag }))}
            onRemove={(tag) => setTags(tagLabels.filter((x) => x !== tag), t("props.tagRemoved", { tag }))}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-folder`}>{t("props.fieldFolder")}</Label>
          <select
            id={`${ids}-folder`}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm disabled:opacity-50"
            value={detail.folderId ?? ""}
            disabled={Boolean(reason)}
            title={reason ?? path}
            onChange={(e) => {
              const next = e.target.value || null
              void save({ folderId: next }, { folderId: detail.folderId }, t("props.saved", { field: t("props.fieldFolder") }))
            }}
          >
            <option value="">{t("props.folderRoot")}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {folderPath(folders, f.id).map((p) => p.name).join(" / ")}
              </option>
            ))}
          </select>
        </div>

        <dl className="space-y-1.5 border-t border-border pt-3">
          <Row label={t("props.space")}>{detail.spaceName ?? t("upload.spaceNone")}</Row>
          <Row label={t("props.uploadedBy")}>{detail.uploaderName}</Row>
          <Row label={t("props.date")}>{formatMediaDate(detail.createdAt, locale)}</Row>
          <Row label={t("props.size")}>{formatMediaSize(detail.sizeBytes, locale)}</Row>
          {dims && <Row label={t("props.dimensions")}>{dims}</Row>}
          <Row label={t("props.type")}>{detail.mimeType}</Row>
          <Row label={t("props.id")}>{detail.id}</Row>
          <Row label={t("props.link")}>{`/api/media/${detail.id}`}</Row>
        </dl>
      </section>

      <section aria-label={t("usage.title")} className="space-y-2 border-t border-border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("usage.title")}</h3>
        <UsageList mediaId={detail.id} />
      </section>
      {usageSlot}
      {detail.canChangeSpace && (
        <SpaceDialog
          open={spaceOpen}
          onOpenChange={setSpaceOpen}
          mediaId={detail.id}
          currentSpace={{ id: detail.spaceId, name: detail.spaceName }}
          spaces={spaces}
          undo={undo}
          onChanged={() => {
            void load()
            onMutated()
          }}
        />
      )}
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        ids={[detail.id]}
        publicShared={detail.publicShared}
        onTrashed={onTrashed}
        onDone={({ trashedIds }) => {
          onMutated()
          if (trashedIds.length > 0) onClose()
        }}
      />
    </div>
  )
}
