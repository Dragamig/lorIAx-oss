"use client"

import { useState, type ReactNode } from "react"
import useSWR from "swr"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { Download, FileQuestion, RotateCw } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { buttonVariants, Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tip } from "./file-block-tip"
import { Hint } from "@/components/ui/hint"
import { PdfPreview } from "./file-block-pdf-preview"
import { KIND_ICONS } from "@/components/media/media-kind-icon"
import { formatMediaSize } from "@/components/media/media-format"
import type { MediaKind } from "@/lib/db/schema"

type Meta = {
  filename: string
  mimeType: string
  kind: MediaKind
  sizeBytes: number
  deletedAt?: string | null
}

class MetaError extends Error {
  constructor(readonly status: number) {
    super(`meta ${status}`)
  }
}

async function fetchMeta(url: string): Promise<Meta> {
  const res = await fetch(url, { credentials: "same-origin" })
  if (!res.ok) throw new MetaError(res.status)
  const data = (await res.json()) as { media: Meta }
  return data.media
}

const CARD = "flex h-[72px] w-full items-center gap-3 rounded-md border border-border bg-card px-3 text-card-foreground"
const KINDS = ["image", "pdf", "document", "video", "audio", "archive", "other"] as const

export function FileBlockView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const t = useTranslations("editor.fileBlock")
  const locale = useLocale()
  const mediaId = node.attrs.mediaId as string | null
  const { data, error, isLoading, mutate } = useSWR<Meta, MetaError>(mediaId ? `/api/media/${mediaId}/meta` : null, fetchMeta, {
    dedupingInterval: 2000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  // Lecteur : l'état d'aperçu reste local, le document partagé n'est pas modifié.
  const [localPreview, setLocalPreview] = useState(node.attrs.preview === true)
  const ring = selected ? "ring-2 ring-ring" : ""

  let body: ReactNode
  if (!mediaId || (error && error.status === 404) || data?.deletedAt) {
    // Média absent ou illisible : aucun nom ni taille des attributs n'est montré.
    body = (
      <div
        role="group"
        aria-label={t("missing")}
        data-media-missing="true"
        className={cn(CARD, "border-dashed bg-muted text-muted-foreground", ring)}
      >
        <FileQuestion className="h-6 w-6 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm">{t("missing")}</span>
        <Hint label={t("notFound")} disabled>
          <Button type="button" variant="ghost" size="sm" disabled aria-label={`${t("download")} : ${t("notFound")}`}>
            <Download aria-hidden="true" />
          </Button>
        </Hint>
      </div>
    )
  } else if (error) {
    body = (
      <div data-file-block-state="error" className={cn(CARD, ring)}>
        <FileQuestion className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm">{t("loadError")}</span>
        <Tip text={t("retry")}>
          <Button type="button" variant="ghost" size="sm" aria-label={t("retry")} onClick={() => void mutate()}>
            <RotateCw aria-hidden="true" />
          </Button>
        </Tip>
      </div>
    )
  } else if (isLoading || !data) {
    body = <div data-file-block-state="loading" className={cn(CARD, "animate-pulse bg-muted", ring)} aria-busy="true" />
  } else {
    const kind: MediaKind = (KINDS as readonly string[]).includes(data.kind) ? data.kind : "other"
    const Icon = KIND_ICONS[kind]
    const isPdf = data.mimeType === "application/pdf"
    body = (
      <div>
        <div data-file-block-state="ready" role="group" aria-label={t("label", { name: data.filename })} className={cn(CARD, ring)}>
          <Icon className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" title={data.filename}>
              {data.filename}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {t(`kind.${kind}`)} · {formatMediaSize(data.sizeBytes, locale)}
            </div>
          </div>
          <Tip text={t("download")}>
            <a
              href={`/api/media/${mediaId}?download=1`}
              download
              aria-label={t("download")}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <Download aria-hidden="true" />
            </a>
          </Tip>
        </div>
        {isPdf ? (
          <PdfPreview
            mediaId={mediaId}
            filename={data.filename}
            open={editor.isEditable ? node.attrs.preview === true : localPreview}
            onOpenChange={(v) => (editor.isEditable ? updateAttributes({ preview: v }) : setLocalPreview(v))}
          />
        ) : null}
      </div>
    )
  }

  return (
    <NodeViewWrapper className="loriax-file-block my-2" data-drag-handle>
      {body}
    </NodeViewWrapper>
  )
}
