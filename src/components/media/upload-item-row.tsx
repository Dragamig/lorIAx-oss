"use client"

import { AlertTriangle, CheckCircle2, Copy, Loader2, Upload } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ActionButton } from "./action-button"
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

  return (
    <li className="space-y-1 border-b border-border py-2 text-sm last:border-0" data-status={item.status}>
      <div className="flex items-center gap-2">
        {item.status === "done" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        ) : item.status === "error" ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
        ) : active ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Upload className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate" title={item.name}>
          {item.name}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatMediaSize(item.size, locale)}</span>
        {active && <ActionButton id="cancelUpload" onAction={() => queue.cancel(item.id)} />}
        {item.status === "error" && item.error?.kind === "network" && (
          <ActionButton id="retryUpload" onAction={() => queue.retry(item.id)} />
        )}
      </div>
      {item.status === "uploading" && (
        <div
          role="progressbar"
          aria-label={item.name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(item.progress * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${item.progress * 100}%` }} />
        </div>
      )}
      {errorText ? (
        <p role="alert" className="pl-6 text-xs text-destructive">
          {errorText}
        </p>
      ) : (
        <p className="pl-6 text-xs text-muted-foreground">{t(`status.${statusKey}`)}</p>
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
