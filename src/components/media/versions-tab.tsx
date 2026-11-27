"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, History } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { mediaVersionContentUrl } from "@/lib/media/urls"
import { VERSIONS_LIMIT, type MediaVersionDto } from "@/lib/media/version-dto"
import { ActionButton } from "./action-button"
import { formatMediaSize } from "./media-format"
import { ReplaceFileDialog, replaceErrorKey, type ReplaceOutcome } from "./replace-file-dialog"

type Props = {
  mediaId: string
  currentVersion: number
  canWrite: boolean
  inTrash: boolean
  usageCount?: number
  /** Appelé après tout changement de version courante (rafraîchit fiche, vignette et liste). */
  onChanged?: () => void
}

type State = { status: "loading" } | { status: "error" } | { status: "ready"; versions: MediaVersionDto[]; current: number }

function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

/** Onglet Versions de la fiche média : remplacer, restaurer, supprimer, télécharger. */
export function VersionsTab({ mediaId, currentVersion, canWrite, inTrash, usageCount = 0, onChanged }: Props) {
  const t = useTranslations("library.versions")
  const locale = useLocale()
  const [state, setState] = useState<State>({ status: "loading" })
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<MediaVersionDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const currentId = useRef(mediaId)
  useEffect(() => {
    currentId.current = mediaId
  }, [mediaId])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/media/${mediaId}/versions`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { currentVersion: number; versions: MediaVersionDto[] }
      if (currentId.current === mediaId) setState({ status: "ready", versions: body.versions, current: body.currentVersion })
    } catch {
      if (currentId.current === mediaId) setState({ status: "error" })
    }
  }, [mediaId])

  useEffect(() => {
    setState({ status: "loading" })
    void load()
  }, [load, currentVersion])

  const refresh = useCallback(async () => {
    await load()
    onChanged?.()
  }, [load, onChanged])

  const lockReason = inTrash ? t("trashReason") : !canWrite ? t("readOnlyReason") : undefined

  /** Annuler = DELETE de la version créée (par id, seulement si elle est encore la courante). */
  const undoCreated = (versionId: string, doneKey: "replaceUndone" | "restoreUndone") => async () => {
    try {
      const res = await fetch(`/api/media/${mediaId}/versions/${versionId}?requireCurrent=1`, { method: "DELETE" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.info(t(doneKey))
    } catch {
      toast.error(t("undoFailed"))
    }
    await refresh()
  }

  const announceReplaced = (outcome: ReplaceOutcome, previousCount: number, oldest: number | null) => {
    const n = outcome.version.version
    const purged = previousCount >= VERSIONS_LIMIT && oldest !== null
    toast.success(purged ? t("replacedPurgedToast", { n: String(n), old: String(oldest), max: String(VERSIONS_LIMIT) }) : t("replacedToast", { n: String(n) }), {
      action: { label: t("undoLabel"), onClick: () => void undoCreated(outcome.version.id, "replaceUndone")() },
    })
  }

  const restore = async (v: MediaVersionDto, current: number) => {
    try {
      const res = await fetch(`/api/media/${mediaId}/versions/${v.version}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: current }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(t(replaceErrorKey(res.status, body.error)))
        if (res.status === 409) await load()
        return
      }
      const body = (await res.json()) as { version: MediaVersionDto }
      const n = body.version.version
      const newId = body.version.id
      toast.success(t("restoredToast", { from: String(v.version), n: String(n) }), {
        action: { label: t("undoLabel"), onClick: () => void undoCreated(newId, "restoreUndone")() },
      })
      await refresh()
    } catch {
      toast.error(t("errGeneric"))
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const target = pendingDelete
    setDeleting(true)
    try {
      const res = await fetch(`/api/media/${mediaId}/versions/${target.id}`, { method: "DELETE" })
      if (!res.ok) {
        toast.error(res.status === 409 ? t("errDeleteConflict") : t("deleteFailed"))
        return
      }
      toast.success(t("deletedToast", { n: String(target.version) }))
      await refresh()
    } catch {
      toast.error(t("deleteFailed"))
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  const download = (v: MediaVersionDto) => {
    const a = document.createElement("a")
    a.href = mediaVersionContentUrl(mediaId, v.version)
    a.download = v.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-3 p-3" role="status" aria-busy="true" aria-label={t("loadingLabel")}>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="m-3 flex items-start gap-2.5 rounded-lg border border-destructive p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-2">
          <p className="font-semibold">{t("errorTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("errorBody")}</p>
          <ActionButton
            id="retryVersions"
            variant="outline"
            size="default"
            showLabel
            onAction={() => {
              setState({ status: "loading" })
              void load()
            }}
          />
        </div>
      </div>
    )
  }

  const { versions, current } = state
  const count = versions.length
  const full = count >= VERSIONS_LIMIT
  const oldestNonCurrent = [...versions].reverse().find((v) => v.version !== current)?.version ?? null
  const replaceReason = lockReason
  const replaceTip = replaceReason ?? (full ? t("replaceTipFull", { max: String(VERSIONS_LIMIT) }) : t("replaceTip"))

  return (
    <div className="flex flex-col">
      <div className="space-y-2 p-3">
        <div title={replaceTip} className="[&>span]:flex [&>span]:w-full [&_button]:w-full">
          <ActionButton
            id="replaceFile"
            variant="default"
            size="default"
            showLabel
            disabledReason={replaceReason}
            onAction={() => setReplaceOpen(true)}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          <div className="flex justify-between font-medium text-foreground">
            <span>{t("quotaCount", { count: String(count), max: String(VERSIONS_LIMIT) })}</span>
            {full && <span className="text-amber-600">{t("limitReached")}</span>}
          </div>
          <div
            role="progressbar"
            aria-label={t("quotaBarLabel")}
            aria-valuemin={0}
            aria-valuemax={VERSIONS_LIMIT}
            aria-valuenow={count}
            className="my-1.5 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div className={`h-full rounded-full ${full ? "bg-amber-500" : "bg-foreground/70"}`} style={{ width: `${(count / VERSIONS_LIMIT) * 100}%` }} />
          </div>
          <p>{full ? t("quotaHintFull") : t("quotaHint", { max: String(VERSIONS_LIMIT) })}</p>
        </div>
      </div>

      {count === 1 && (
        <div className="flex flex-col items-center gap-1 px-5 py-6 text-center text-sm text-muted-foreground">
          <History className="h-7 w-7" aria-hidden />
          <p className="font-semibold text-foreground">{t("emptyTitle")}</p>
          <p>{t("emptyBody")}</p>
        </div>
      )}

      <ul aria-label={t("listLabel")} className="border-t border-border">
        {versions.map((v) => {
          const isCurrent = v.version === current
          const restoreReason = isCurrent ? t("currentNoRestore") : lockReason
          const deleteReason = isCurrent
            ? count === 1
              ? t("singleNoDelete")
              : t("currentNoDelete")
            : lockReason
          const n = String(v.version)
          return (
            <li
              key={v.id}
              data-version={v.version}
              className={`grid h-[84px] grid-cols-[44px_1fr_auto] items-start gap-2.5 overflow-hidden border-b border-border px-3 py-2.5 ${isCurrent ? "bg-muted" : ""}`}
            >
              {v.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaVersionContentUrl(mediaId, v.version)}
                  alt=""
                  loading="lazy"
                  className="h-11 w-11 rounded-md border border-border object-cover"
                />
              ) : (
                <div className="h-11 w-11 rounded-md border border-border bg-muted" aria-hidden />
              )}
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
                  <span>v{n}</span>
                  {isCurrent && <span className="rounded-full bg-emerald-100 px-1.5 text-[0.6875rem] leading-[18px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{t("current")}</span>}
                  {v.restoredFrom !== null && (
                    <span className="truncate rounded-full bg-sky-100 px-1.5 text-[0.6875rem] leading-[18px] text-sky-900 dark:bg-sky-950 dark:text-sky-200">{t("restoredFrom", { n: String(v.restoredFrom) })}</span>
                  )}
                </div>
                <p className="truncate text-xs" title={v.filename}>
                  {v.filename}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {v.createdByName
                    ? t("metaAuthor", { size: formatMediaSize(v.sizeBytes, locale), date: formatDateTime(v.createdAt, locale), author: v.createdByName })
                    : t("meta", { size: formatMediaSize(v.sizeBytes, locale), date: formatDateTime(v.createdAt, locale) })}
                </p>
                {v.comment && (
                  <p className="truncate text-xs" title={v.comment}>
                    {v.comment}
                  </p>
                )}
              </div>
              <div className="flex">
                <ActionButton tipAlign="end" id="downloadVersion" label={t("downloadLabel", { n })} onAction={() => download(v)} />
                <ActionButton tipAlign="end" id="restoreVersion" label={t("restoreLabel", { n })} disabledReason={restoreReason} onAction={() => void restore(v, current)} />
                <ActionButton tipAlign="end" id="deleteVersion" label={t("deleteLabel", { n })} disabledReason={deleteReason} onAction={() => setPendingDelete(v)} />
              </div>
            </li>
          )
        })}
      </ul>

      <ReplaceFileDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        mediaId={mediaId}
        expectedVersion={current}
        usageCount={usageCount}
        onStale={() => void load()}
        onReplaced={(outcome) => {
          announceReplaced(outcome, count, oldestNonCurrent)
          void refresh()
        }}
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? t("deleteBody", { n: String(pendingDelete.version), name: pendingDelete.filename, date: formatDateTime(pendingDelete.createdAt, locale) })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <ActionButton id="pickerCancel" variant="outline" size="default" showLabel onAction={() => setPendingDelete(null)} disabledReason={deleting ? t("busy") : undefined} />
            <ActionButton id="confirmDeleteVersion" variant="destructive" size="default" showLabel onAction={() => void confirmDelete()} disabledReason={deleting ? t("busy") : undefined} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
