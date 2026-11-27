"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Copy, Loader2, Upload, WifiOff } from "lucide-react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ActionButton } from "./action-button"
import { CancelUploadDialog } from "./cancel-upload-dialog"
import { formatMediaSize } from "./media-format"
import { extensionOf, type UploadItem, type UploadQueue } from "./upload-queue"

export function UploadItemRow({ item, queue }: { item: UploadItem; queue: UploadQueue }) {
  const t = useTranslations("library.upload")
  const locale = useLocale()
  const active = item.status === "hashing" || item.status === "queued" || item.status === "uploading"
  const errorText = item.error
    ? item.error.kind === "format"
      ? t("errors.format", { ext: item.error.ext || extensionOf(item.name) || "?" })
      : item.error.kind === "too_large"
        ? t("errors.too_large", { limit: String(item.error.limitMb ?? 50) })
        : t(`errors.${item.error.kind}`)
    : null
  const statusKey = item.status === "done" && item.reused ? "reused" : item.status
  const tl = useTranslations("library.upload.large")
  const [confirming, setConfirming] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const retryIn = item.retryAt ? Math.max(0, Math.ceil((item.retryAt - now) / 1000)) : null
  useEffect(() => {
    if (!item.retryAt) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 500)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [item.retryAt])
  const pct = Math.round(item.progress * 100)
  const large = Boolean(item.large)
  const cancellable = active || item.status === "paused" || (large && item.error?.kind === "interrupted")
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)
  let detail: string | null = null
  if (large) {
    if (item.status === "paused") detail = tl("paused", { pct: String(pct), done: String(item.partsDone ?? 0), total: String(item.partsTotal ?? 0) })
    else if (item.status === "uploading" && item.verifying) detail = tl("verifying")
    else if (item.status === "uploading" && retryIn !== null) detail = tl("retry", { pct: String(pct), s: String(retryIn) })
    else if (item.status === "uploading" && item.partsTotal) {
      detail = tl("part", { part: String(Math.min(item.partsTotal, (item.partsDone ?? 0) + 1)), total: String(item.partsTotal), pct: String(pct) })
      if (item.speed) detail += tl("speed", { speed: mb(item.speed) })
      if (item.etaSec !== undefined) {
        detail += item.etaSec >= 90 ? tl("etaMinutes", { m: String(Math.ceil(item.etaSec / 60)) }) : tl("etaSeconds", { s: String(item.etaSec) })
      }
    }
  }
  const retrying = large && item.status === "uploading" && retryIn !== null
  const askCancel = () => (large ? setConfirming(true) : queue.cancel(item.id))
  const doCancel = () => {
    setConfirming(false)
    queue.cancel(item.id)
    toast(tl("toastCancelled", { name: item.name }))
  }

  return (
    <li className="space-y-1 border-b border-border py-2 text-sm last:border-0" data-status={item.status}>
      <div className="flex items-center gap-2">
        {item.status === "done" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        ) : item.status === "error" ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
        ) : retrying ? (
          <WifiOff className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
        ) : active ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Upload className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate" title={item.name}>
          {item.name}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatMediaSize(item.size, locale)}</span>
        {large && item.status === "uploading" && !item.verifying && (
          <ActionButton
            id="pauseUpload"
            tipAlign="end"
            label={tl("pauseLabel", { name: item.name })}
            onAction={() => {
              queue.pause(item.id)
              toast(tl("toastPaused", { name: item.name }))
            }}
          />
        )}
        {large && item.status === "paused" && (
          <ActionButton
            id="resumeUpload"
            tipAlign="end"
            label={tl("resumeLabel", { name: item.name })}
            onAction={() => {
              queue.resume(item.id)
              toast(tl("toastResumed", { name: item.name }))
            }}
          />
        )}
        {cancellable && !item.verifying && (
          <ActionButton id="cancelUpload" tipAlign="end" label={large ? tl("cancelLabel", { name: item.name }) : undefined} onAction={askCancel} />
        )}
        {item.status === "error" && (item.error?.kind === "network" || item.error?.kind === "interrupted") && (
          <ActionButton id="retryUpload" tipAlign="end" onAction={() => queue.retry(item.id)} />
        )}
      </div>
      {(item.status === "uploading" || item.status === "paused" || (large && item.status === "error")) && (
        <div
          role="progressbar"
          aria-label={item.name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(item.progress * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className={`h-full rounded-full ${retrying || item.status === "error" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${item.progress * 100}%` }} />
        </div>
      )}
      {errorText ? (
        <p role="alert" className="pl-6 text-xs text-destructive">
          {errorText}
        </p>
      ) : (
        <p
          className={`pl-6 text-xs ${retrying ? "text-destructive" : "text-muted-foreground"}`}
          aria-live={item.status === "uploading" && large ? "off" : undefined}
        >
          {detail ?? t(`status.${statusKey}`)}
        </p>
      )}
      {large && (
        <CancelUploadDialog open={confirming} name={item.name} percent={pct} onKeep={() => setConfirming(false)} onConfirm={doCancel} />
      )}
      {item.status === "duplicate" && item.duplicateOf && (
        <div className="space-y-1.5 pl-6">
          <p className="text-xs">{t("duplicateOf", { name: item.duplicateOf.filename, space: item.duplicateOf.spaceName })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => queue.resolveDuplicate(item.id, "reuse")}>
              <Copy aria-hidden />
              {t("reuse")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => queue.resolveDuplicate(item.id, "upload")}>
              <Upload aria-hidden />
              {t("uploadAnyway")}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
