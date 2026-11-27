"use client"

import { AlertTriangle, Check, Globe, Lock } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import type { MediaListItem } from "@/lib/media/list"
import { cn } from "@/lib/utils"
import { startMediaDrag, type MediaDrag } from "./media-drag"
import { formatMediaDate, formatMediaSize } from "./media-format"
import { KIND_ICONS } from "./media-kind-icon"

/** Dimensions uniques de toutes les tuiles (pixels), partagées par la grille et son squelette. */
export const TILE_SIZE = {
  width: 188,
  compactWidth: 166,
  /** Pied de hauteur fixe : trois lignes tronquées. */
  footer: 66,
  gap: 12,
  /** Largeur + pied (vignette carrée). */
  height: 188 + 66,
  compactHeight: 166 + 66,
} as const

export function tileDims(compact?: boolean) {
  return compact
    ? { width: TILE_SIZE.compactWidth, height: TILE_SIZE.compactHeight }
    : { width: TILE_SIZE.width, height: TILE_SIZE.height }
}

export type TileItem = MediaListItem & { publicShared?: boolean }

export type TileMods = { shift: boolean; ctrl: boolean; box: boolean }

type Props = {
  item: TileItem
  selected: boolean
  current: boolean
  compact?: boolean
  focusable: boolean
  /** Refusé par la dernière action de lot : reste sélectionné et marqué. */
  flagged?: boolean
  drag?: MediaDrag
  onOpen: (item: MediaListItem) => void
  onToggle: (id: string, mods: TileMods) => void
}

export function MediaTile({ item, selected, current, compact, focusable, flagged, drag, onOpen, onToggle }: Props) {
  const t = useTranslations("library")
  const locale = useLocale()
  const Icon = KIND_ICONS[item.kind]
  const { width, height } = tileDims(compact)
  const name = item.title || item.filename
  const kindLabel = t(`kinds.${item.kind}`)
  const size = formatMediaSize(item.sizeBytes, locale)
  const date = formatMediaDate(item.createdAt, locale)
  const tip = [
    name,
    `${t("grid.tipSize")} : ${size}`,
    `${t("grid.tipSpace")} : ${item.spaceName ?? t("grid.noSpace")}`,
    `${t("grid.tipBy")} : ${item.uploaderName}`,
    `${t("grid.tipDate")} : ${date}`,
  ].join("\n")

  return (
    <div
      role="option"
      data-media-tile
      data-media-id={item.id}
      data-flagged={flagged ? "true" : undefined}
      draggable={Boolean(drag)}
      onDragStart={(e) => startMediaDrag(e, item.id, drag)}
      onDragEnd={drag?.onEnd}
      aria-selected={selected}
      aria-current={current ? "true" : undefined}
      tabIndex={focusable ? 0 : -1}
      title={tip}
      style={{ width, height }}
      className={cn(
        "group relative flex shrink-0 cursor-pointer flex-col overflow-hidden rounded-lg border bg-card text-card-foreground outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        flagged ? "border-destructive ring-1 ring-destructive" : selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30",
        current && "bg-accent"
      )}
      onClick={(e) => {
        const box = !!(e.target as HTMLElement).closest("[data-select-box]")
        const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, box }
        if (box || mods.shift || mods.ctrl) onToggle(item.id, mods)
        else onOpen(item)
      }}
    >
      <div
        className="relative flex shrink-0 items-center justify-center bg-muted text-muted-foreground"
        style={{ width, height: width }}
      >
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt={item.altText ?? ""}
            loading="lazy"
            draggable={false}
            className={cn("h-full w-full object-cover", item.kind === "pdf" && "object-top")}
          />
        ) : (
          <Icon className="h-10 w-10" aria-hidden />
        )}
        <span
          data-select-box
          role="presentation"
          aria-label={t("grid.select", { name })}
          className={cn(
            "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border bg-background/90 text-primary-foreground",
            selected ? "border-primary bg-primary" : "border-border opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          )}
        >
          {selected && <Check className="h-4 w-4" aria-hidden />}
        </span>
        <span className="absolute right-2 top-2 flex gap-1">
          {flagged && (
            <span title={t("bulk.flagged")} className="rounded-md bg-background/90 p-1 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-label={t("bulk.flagged")} />
            </span>
          )}
          {item.publicShared && (
            <span title={t("grid.publicShared")} className="rounded-md bg-background/90 p-1 text-foreground">
              <Globe className="h-3.5 w-3.5" aria-label={t("grid.publicShared")} />
            </span>
          )}
          {!item.canWrite && (
            <span
              title={t("grid.readOnly")}
              className="flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-xs text-foreground"
            >
              <Lock className="h-3 w-3" aria-hidden />
              {t("grid.readOnly")}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-col justify-center px-2.5 text-xs" style={{ height: TILE_SIZE.footer }}>
        <p className="h-[22px] truncate text-sm font-medium leading-[22px]">{name}</p>
        <p className="h-[18px] truncate leading-[18px] text-muted-foreground">
          {kindLabel} · {size}
        </p>
        <p className="h-[18px] truncate leading-[18px] text-muted-foreground">{date}</p>
      </div>
    </div>
  )
}
