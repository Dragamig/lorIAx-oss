"use client"

import { useLocale, useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { MediaListItem } from "@/lib/media/list"
import { cn } from "@/lib/utils"
import { ActionButton } from "./action-button"
import { formatMediaSize } from "./media-format"
import { KIND_ICONS } from "./media-kind-icon"

type Props = {
  /** Liste courante, dans l'ordre affiché : la navigation s'y limite. */
  items: MediaListItem[]
  /** Position ouverte ; `null` : fermé. */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
}

/** Aperçu agrandi navigable au clavier ; le focus revient à la tuile d'origine. */
export function PreviewDialog({ items, index, onIndexChange, onClose }: Props) {
  const t = useTranslations("library")
  const locale = useLocale()
  const item = index !== null ? items[index] : undefined
  const open = Boolean(item)
  const last = items.length - 1

  const go = (next: number) => {
    if (index === null) return
    const target = Math.max(0, Math.min(last, next))
    if (target !== index) onIndexChange(target)
  }

  const name = item ? item.title || item.filename : ""
  const Icon = item ? KIND_ICONS[item.kind] : null
  const mime = item?.mimeType.toLowerCase() ?? ""

  let body: React.ReactNode = null
  if (item && Icon) {
    if (item.kind === "image") {
      // SVG inclus : toujours en balise img, jamais en object ni en ligne.
      // eslint-disable-next-line @next/next/no-img-element
      body = <img src={item.url} alt={item.altText ?? ""} className="max-h-full max-w-full object-contain" />
    } else if (mime === "application/pdf") {
      body = <iframe src={item.url} title={t("preview.frame", { name })} className="h-full w-full rounded-md border border-border bg-background" />
    } else if (item.kind === "video") {
      body = <video key={item.id} src={item.url} controls className="max-h-full max-w-full" />
    } else if (item.kind === "audio") {
      body = <audio key={item.id} src={item.url} controls className="w-full max-w-md" />
    } else {
      body = (
        <div className="flex flex-col items-center gap-3 text-center">
          <Icon className="h-16 w-16 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("preview.noPreview")}</p>
          <a href={item.url} download={item.filename} className={buttonVariants({ variant: "default" })}>
            <Download aria-hidden="true" />
            {t("preview.download")}
          </a>
        </div>
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {item && (
        <DialogContent
          className={cn("h-[85vh] max-w-[calc(100%-2rem)] grid-rows-[auto_1fr] sm:max-w-5xl")}
          onKeyDown={(e) => {
            // Les flèches pilotent la recherche dans un lecteur : on les lui laisse.
            if ((e.target as HTMLElement).closest("video, audio")) return
            if (e.key === "ArrowRight") {
              e.preventDefault()
              go(index! + 1)
            } else if (e.key === "ArrowLeft") {
              e.preventDefault()
              go(index! - 1)
            }
          }}
          finalFocus={() => document.querySelector<HTMLElement>(`[data-media-id="${item.id}"]`) ?? true}
        >
          <div className="flex items-center gap-2 pr-8">
            <ActionButton id="previewPrev" onAction={() => go(index! - 1)} disabledReason={index === 0 ? t("preview.first") : undefined} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{t("preview.title", { name })}</DialogTitle>
              <DialogDescription className="mt-1 truncate text-xs">
                <span aria-live="polite">{t("preview.position", { index: String(index! + 1), total: String(items.length) })}</span>
                {" · "}
                {t("preview.meta", { kind: t(`kinds.${item.kind}`), size: formatMediaSize(item.sizeBytes, locale) })}
              </DialogDescription>
            </div>
            <ActionButton id="previewNext" onAction={() => go(index! + 1)} disabledReason={index === last ? t("preview.last") : undefined} />
          </div>
          <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md bg-muted p-2">{body}</div>
        </DialogContent>
      )}
    </Dialog>
  )
}
