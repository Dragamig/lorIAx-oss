"use client"

import { useEffect, useState } from "react"
import TiptapImage from "@tiptap/extension-image"
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react"
import { ImageOff } from "lucide-react"
import { useTranslations } from "next-intl"
import { mediaIdFromUrl, useMediaPresence } from "@/components/media/use-media-presence"

/** Délai avant l'unique nouvelle tentative : une coupure réseau passagère ne fige pas l'état « manquant ». */
export const IMAGE_RETRY_DELAY_MS = 500

function ImageView({ node, selected, HTMLAttributes }: NodeViewProps) {
  const t = useTranslations("document")
  const { src, alt, title, width, height } = node.attrs as {
    src?: string
    alt?: string
    title?: string
    width?: number | string | null
    height?: number | string | null
  }
  const [loadFailed, setFailed] = useState(false)
  // Média à la corbeille : encore servi en 200, détecté par /meta.
  const { missing: trashedOrGone } = useMediaPresence(mediaIdFromUrl(src))
  const failed = loadFailed || trashedOrGone
  const [attempt, setAttempt] = useState(0)

  // Une nouvelle source (remplacement, restauration au rechargement) retente le chargement.
  useEffect(() => {
    setFailed(false)
    setAttempt(0)
  }, [src])

  // Premier échec : une seule nouvelle tentative différée ; le second échec fige l'état manquant.
  useEffect(() => {
    if (attempt !== 1 || failed) return
    const timer = window.setTimeout(() => setAttempt(2), IMAGE_RETRY_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [attempt, failed])

  const onError = () => {
    if (attempt === 0) setAttempt(1)
    else if (attempt >= 2) setFailed(true)
  }

  // Les attributs du nœud et ceux de l'extension s'appliquent ; la source n'est jamais modifiée.
  const { class: extraClass, ...rest } = (HTMLAttributes ?? {}) as Record<string, unknown> & { class?: string }
  const size = {
    width: width ?? undefined,
    height: height ?? undefined,
  }

  return (
    <NodeViewWrapper className="loriax-image" data-drag-handle>
      {failed ? (
        <div
          role="img"
          aria-label={alt ? t("mediaMissingNamed", { alt }) : t("mediaMissing")}
          data-media-missing="true"
          style={width ? { width: typeof width === "number" ? `${width}px` : width, maxWidth: "100%" } : undefined}
          className={`flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted text-muted-foreground ${
            selected ? "ring-2 ring-ring" : ""
          }`}
        >
          <ImageOff className="h-6 w-6" aria-hidden="true" />
          <span className="text-sm">{t("mediaMissing")}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...rest}
          key={attempt === 2 ? "retry" : "first"}
          src={src}
          alt={alt ?? ""}
          title={title ?? undefined}
          {...size}
          onError={onError}
          className={[extraClass, selected ? "ring-2 ring-ring" : ""].filter(Boolean).join(" ") || undefined}
        />
      )}
    </NodeViewWrapper>
  )
}

/** Image TipTap dont la vue affiche « Média manquant » si la source ne charge pas. La source n'est jamais modifiée. */
export const ImageWithMissingState = TiptapImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})
