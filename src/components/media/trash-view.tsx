"use client"

import { useCallback, useLayoutEffect, useRef } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useVirtualizer } from "@tanstack/react-virtual"
import { AlertTriangle, Trash2 } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import type { MediaListItem } from "@/lib/media/list"
import { cn } from "@/lib/utils"
import { ActionButton } from "./action-button"
import { formatMediaDate } from "./media-format"
import { KIND_ICONS } from "./media-kind-icon"
import { MediaGridSkeleton } from "./media-grid"
import { LibraryErrorState, LoadMoreError } from "./media-states"
import type { Selection } from "./use-selection"

const ROW_HEIGHT = 48
const DAY_MS = 86_400_000
const GRID_COLS = "grid-cols-[2rem_minmax(0,3fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,2fr)_5rem]"

type Props = {
  items: MediaListItem[]
  selection: Selection
  hasMore: boolean
  loadMore: () => void
  isValidating: boolean
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  /** Restaure ces médias (unitaire depuis une ligne, groupé depuis la barre). */
  onRestore: (ids: string[]) => void
  /** Effacement définitif d'une ligne : fourni aux seuls admins (`canErase`). */
  onErase?: (ids: string[]) => void
  /** Médias refusés par la dernière action de lot. */
  flaggedIds?: Set<string>
  /** Raison affichée quand la restauration est impossible (lecture seule). */
  writeDisabledReason?: string
  /** Horloge injectable pour le décompte avant purge. */
  now?: number
}

/** Vue Corbeille : médias supprimés, délai avant purge, contenus touchés, restauration. */
export function TrashView({
  items,
  selection,
  hasMore,
  loadMore,
  isValidating,
  isLoading,
  isError,
  onRetry,
  onRestore,
  onErase,
  flaggedIds,
  writeDisabledReason,
  now,
}: Props) {
  const t = useTranslations("library")
  const locale = useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: { width: 1000, height: 600 },
  })
  const rows = virtualizer.getVirtualItems()
  const last = rows[rows.length - 1]?.index ?? -1
  useLayoutEffect(() => {
    if (hasMore && !isValidating && last >= items.length - 10) loadMore()
  }, [hasMore, isValidating, last, items.length, loadMore])

  const purgeLabel = useCallback(
    (purgeAt: string | null) => {
      if (!purgeAt) return ""
      const left = Math.ceil((new Date(purgeAt).getTime() - (now ?? Date.now())) / DAY_MS)
      if (left <= 0) return t("trashView.purgeSoon")
      return t(left === 1 ? "trashView.daysLeftOne" : "trashView.daysLeft", { count: String(left) })
    },
    [now, t]
  )
  const affectedLabel = (n: number) =>
    n === 0
      ? t("trashView.affectedNone")
      : t(n === 1 ? "trashView.affectedOne" : "trashView.affectedMany", { count: String(n) })

  if (isError && items.length === 0) return <LibraryErrorState onRetry={onRetry ?? (() => {})} />
  if (isLoading) return <MediaGridSkeleton />
  if (items.length === 0) return <EmptyState icon={Trash2} title={t("trashView.empty")} />

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div
        role="grid"
        aria-multiselectable="true"
        aria-label={t("trashView.ariaLabel")}
        aria-colcount={6}
        aria-rowcount={items.length + 1}
      >
        <div role="row" className={cn("sticky top-0 z-10 grid gap-3 border-b border-border bg-background px-4", GRID_COLS)}>
          <div role="columnheader" className="flex h-9 items-center">
            <span className="sr-only">{t("list.columns.select")}</span>
          </div>
          {(["name", "deletedOn", "purge", "affected"] as const).map((k) => (
            <div key={k} role="columnheader" className="flex h-9 items-center text-xs font-medium text-muted-foreground">
              {t(`trashView.columns.${k}`)}
            </div>
          ))}
          <div role="columnheader" className="flex h-9 items-center">
            <span className="sr-only">{t("trashView.columns.actions")}</span>
          </div>
        </div>
        <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {rows.map((vr) => {
            const item = items[vr.index]
            const Icon = KIND_ICONS[item.kind]
            const selected = selection.isSelected(item.id)
            const flagged = flaggedIds?.has(item.id)
            const name = item.title || item.filename
            return (
              <div
                key={item.id}
                role="row"
                aria-rowindex={vr.index + 2}
                aria-selected={selected}
                data-media-row
                data-media-id={item.id}
                data-flagged={flagged ? "true" : undefined}
                title={name}
                className={cn(
                  "absolute inset-x-0 grid items-center gap-3 border-b border-border/60 px-4 text-sm",
                  GRID_COLS,
                  flagged ? "bg-destructive/10" : selected ? "bg-primary/10" : "hover:bg-muted/60"
                )}
                style={{ top: vr.start, height: ROW_HEIGHT }}
              >
                <span role="gridcell" className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={selected}
                    aria-label={t("list.selectRow", { name })}
                    title={t("list.selectRow", { name })}
                    onChange={() => selection.toggle(item.id)}
                  />
                </span>
                <span role="gridcell" className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{name}</span>
                  {flagged && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-label={t("bulk.flagged")} />}
                </span>
                <span role="gridcell" className="truncate text-muted-foreground">
                  {item.deletedAt ? formatMediaDate(item.deletedAt, locale) : ""}
                </span>
                <span role="gridcell" className="truncate text-muted-foreground">{purgeLabel(item.purgeAt)}</span>
                <span role="gridcell" className="truncate text-muted-foreground">{affectedLabel(item.affectedCount ?? 0)}</span>
                <span role="gridcell" className="flex justify-end">
                  <ActionButton id="restore" disabledReason={writeDisabledReason} onAction={() => onRestore([item.id])} />
                  {onErase && <ActionButton id="eraseForever" variant="ghost" onAction={() => onErase([item.id])} />}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {isError && <LoadMoreError onRetry={onRetry ?? (() => {})} />}
      {isValidating && hasMore && (
        <p role="status" className="py-3 text-center text-xs text-muted-foreground">
          {t("grid.loadingMore")}
        </p>
      )}
    </div>
  )
}
