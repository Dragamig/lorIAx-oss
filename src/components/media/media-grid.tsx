"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Skeleton } from "@/components/ui/skeleton"
import type { MediaListItem } from "@/lib/media/list"
import type { MediaDrag } from "./media-drag"
import { LibraryErrorState, LoadMoreError, MediaEmptyState } from "./media-states"
import { MediaTile, TILE_SIZE, tileDims, type TileItem, type TileMods } from "./media-tile"
import { useMediaNav } from "./use-media-nav"
import type { Selection } from "./use-selection"

const PADDING = 16

export type MediaViewProps = {
  items: MediaListItem[]
  selection: Selection
  currentId: string | null
  onOpen: (item: MediaListItem) => void
  hasMore: boolean
  loadMore: () => void
  isValidating: boolean
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  hasActiveFilters?: boolean
  onResetFilters?: () => void
  /** Médias refusés par la dernière action de lot. */
  flaggedIds?: Set<string>
  drag?: MediaDrag
}

/**
 * Largeur du conteneur défilant. Le conteneur n'existe qu'une fois les états
 * chargement et erreur passés : on ré-observe dès que l'élément change.
 */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  const observed = useRef<HTMLElement | null>(null)
  const ro = useRef<ResizeObserver | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === observed.current) return
    ro.current?.disconnect()
    observed.current = el
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver !== "undefined") {
      ro.current = new ResizeObserver(measure)
      ro.current.observe(el)
    }
  })
  useLayoutEffect(() => () => ro.current?.disconnect(), [])
  return width
}

export function MediaGridSkeleton({ compact }: { compact?: boolean }) {
  const t = useTranslations("library.states")
  const { width, height } = tileDims(compact)
  return (
    <div
      role="status"
      aria-label={t("loading")}
      className="flex flex-wrap gap-3 p-4"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} style={{ width, height }} />
      ))}
    </div>
  )
}

export function MediaGrid({
  items,
  selection,
  currentId,
  onOpen,
  hasMore,
  loadMore,
  isValidating,
  isLoading,
  isError,
  onRetry,
  hasActiveFilters,
  onResetFilters,
  flaggedIds,
  drag,
  compact,
}: MediaViewProps & { compact?: boolean }) {
  const t = useTranslations("library")
  const scrollRef = useRef<HTMLDivElement>(null)
  const width = useWidth(scrollRef)
  const { width: tileW, height: tileH } = tileDims(compact)
  const columns = Math.max(1, Math.floor((width - PADDING * 2 + TILE_SIZE.gap) / (tileW + TILE_SIZE.gap)))
  const rowCount = Math.ceil(items.length / columns)
  const rowHeight = tileH + TILE_SIZE.gap

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    initialRect: { width: 1000, height: 600 },
  })

  const scrollToIndex = useCallback(
    (index: number) => virtualizer.scrollToIndex(Math.floor(index / columns)),
    [virtualizer, columns]
  )

  const nav = useMediaNav({ items, columns, selection, onOpen, scrollToIndex, containerRef: scrollRef })

  const virtualRows = virtualizer.getVirtualItems()
  const lastRow = virtualRows[virtualRows.length - 1]?.index ?? -1
  useLayoutEffect(() => {
    if (hasMore && !isValidating && lastRow >= rowCount - 2) loadMore()
  }, [hasMore, isValidating, lastRow, rowCount, loadMore])

  const onToggle = (id: string, mods: TileMods) => {
    if (mods.shift) selection.range(id)
    else selection.toggle(id)
  }

  if (isError && items.length === 0) return <LibraryErrorState onRetry={onRetry ?? (() => {})} />
  if (isLoading) return <MediaGridSkeleton compact={compact} />
  if (items.length === 0) return <MediaEmptyState hasActiveFilters={hasActiveFilters} onResetFilters={onResetFilters} />

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div
        role="listbox"
        aria-multiselectable="true"
        aria-label={t("grid.ariaLabel")}
        className="relative"
        style={{ height: virtualizer.getTotalSize() + PADDING * 2 }}
        {...nav.containerProps}
      >
        {virtualRows.map((row) => {
          const slice = items.slice(row.index * columns, row.index * columns + columns)
          return (
            <div
              key={row.key}
              role="presentation"
              className="absolute left-0 flex"
              style={{ top: row.start + PADDING, left: PADDING, gap: TILE_SIZE.gap, height: tileH }}
            >
              {slice.map((item) => (
                <MediaTile
                  key={item.id}
                  item={item as TileItem}
                  compact={compact}
                  selected={selection.isSelected(item.id)}
                  current={currentId === item.id}
                  focusable={nav.focusedId === item.id}
                  flagged={flaggedIds?.has(item.id)}
                  drag={drag}
                  onOpen={onOpen}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )
        })}
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
