"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ZIP_MAX_BYTES,
  ZIP_MAX_FILES,
  ZIP_MAX_SELECTION,
  ZIP_RATE_COUNT,
  ZIP_RATE_MINUTES,
} from "@/lib/media/zip-limits"
import { ActionButton } from "./action-button"
import { formatMediaSize } from "./media-format"

export type ZipSource = { ids: string[] } | { folderId: string }

type Props = {
  source: ZipSource
  /** Nom affiché pour un dossier. */
  folderName?: string
  /** Nombre de fichiers connus de la portée (sélection : ids.length ; dossier : total du sous-arbre). */
  fileCount: number
  /** Taille cumulée connue (sélection seulement). */
  totalBytes?: number
  /** Raison externe de désactivation (aucun dossier choisi, par exemple). */
  disabledReason?: string
  variant?: "bar" | "tree"
}

export function zipUrl(source: ZipSource, probe: boolean): string {
  const sp = new URLSearchParams()
  if ("ids" in source) sp.set("ids", source.ids.join(","))
  else sp.set("folderId", source.folderId)
  if (probe) sp.set("probe", "1")
  return `/api/media/zip?${sp.toString()}`
}

/** Lance le téléchargement par navigation : le navigateur reçoit le flux, rien n'est lu en mémoire. */
function triggerDownload(url: string) {
  const a = document.createElement("a")
  a.href = url
  a.rel = "noopener"
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function Gauge({ label, value, max, text, noValue }: { label: string; value: number; max: number; text: string; noValue?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{noValue ?? text}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={noValue ? undefined : value}
        aria-valuetext={noValue ?? text}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`}
          style={{ width: noValue ? "0%" : `${Math.max(pct, value > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  )
}

export function ZipDownloadButton({ source, folderName, fileCount, totalBytes, disabledReason, variant = "bar" }: Props) {
  const t = useTranslations("library.zip")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSelection = "ids" in source
  const tooMany = isSelection && fileCount > ZIP_MAX_SELECTION
  const reason =
    disabledReason ??
    (busy ? t("busy") : undefined) ??
    (tooMany ? t("tooManySelected", { max: String(ZIP_MAX_SELECTION) }) : undefined)
  const overFiles = fileCount > ZIP_MAX_FILES
  const overBytes = totalBytes !== undefined && totalBytes > ZIP_MAX_BYTES
  const blocked = overFiles || overBytes
  const blockedReason = overFiles ? t("tooBig") : overBytes ? t("tooBig") : undefined

  const close = (o: boolean) => {
    if (busy) return
    setOpen(o)
    if (!o) setError(null)
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(zipUrl(source, true), { method: "GET", headers: { Accept: "application/json" } })
      if (res.status === 204) {
        const skipped = Number(res.headers.get("X-Zip-Skipped") ?? "0")
        triggerDownload(zipUrl(source, false))
        setOpen(false)
        toast.info(skipped > 0 ? t("startedSkipped", { count: String(skipped) }) : t("started"))
        return
      }
      let message: string
      if (res.status === 413) message = t("tooBig")
      else if (res.status === 429) {
        const wait = Number(res.headers.get("Retry-After") ?? "0")
        message = wait > 0 && wait <= 60 ? t("inFlight") : t("rateLimited", { minutes: String(Math.max(1, Math.ceil(wait / 60) || ZIP_RATE_MINUTES)) })
      } else if (res.status === 404) message = t("nothing")
      else message = t("failed")
      setError(message)
      toast.error(message)
    } catch {
      setError(t("failed"))
      toast.error(t("failed"))
    } finally {
      setBusy(false)
    }
  }

  const scope = isSelection
    ? fileCount === 1
      ? t("scopeOne")
      : t("scopeMany", { count: String(fileCount) })
    : t("scopeFolder", { name: folderName ?? "" })

  return (
    <>
      <ActionButton
        id={variant === "tree" ? "downloadFolderZip" : "downloadZip"}
        showLabel={variant === "bar"}
        size={variant === "bar" ? "sm" : "icon-sm"}
        variant="ghost"
        disabledReason={reason}
        onAction={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription className="font-medium text-foreground">{scope}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Gauge
              label={t("files")}
              value={fileCount}
              max={ZIP_MAX_FILES}
              text={t("filesOf", { count: String(fileCount), max: String(ZIP_MAX_FILES) })}
            />
            <Gauge
              label={t("size")}
              value={totalBytes ?? 0}
              max={ZIP_MAX_BYTES}
              text={t("sizeOf", {
                size: formatMediaSize(totalBytes ?? 0, locale),
                max: formatMediaSize(ZIP_MAX_BYTES, locale),
              })}
              noValue={totalBytes === undefined ? t("sizeUnknown") : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {t("note", { count: String(ZIP_RATE_COUNT), minutes: String(ZIP_RATE_MINUTES) })}
            </p>
            {busy ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("checking")}
              </p>
            ) : null}
            {blockedReason && !error ? (
              <p role="alert" className="text-sm text-destructive">
                {blockedReason}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <ActionButton id="cancelZip" showLabel variant="outline" size="default" disabledReason={busy ? t("busy") : undefined} onAction={() => close(false)} />
            <ActionButton
              id="startZip"
              showLabel
              variant="default"
              size="default"
              disabledReason={blocked ? t("tooBig") : busy ? t("busy") : undefined}
              onAction={() => void start()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
