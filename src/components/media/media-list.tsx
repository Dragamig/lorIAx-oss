"use client"

import { useCallback, useLayoutEffect, useRef } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useVirtualizer } from "@tanstack/react-virtual"
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import type { MediaSort } from "@/lib/media/filters"
import type { MediaListItem } from "@/lib/media/list"
import { cn } from "@/lib/utils"
import { MediaGridSkeleton, type MediaViewProps } from "./media-grid"
import { startMediaDrag } from "./media-drag"
import { formatMediaDate, formatMediaSize } from "./media-format"
import { KIND_ICONS } from "./media-kind-icon"
import { LibraryErrorState, LoadMoreError, MediaEmptyState } from "./media-states"
import { useMediaNav } from "./use-media-nav"

const ROW_HEIGHT = 40
const GRID_COLS = "grid-cols-[2rem_minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)]"

type Column = { key: "name" | "kind" | "size" | "uploader" | "date" | "usage"; sort?: MediaSort; align?: "right" }
const COLUMNS: Column[] = [
  { key: "name", sort: "filename" },
  { key: "kind", sort: "kind" },
  { key: "size", sort: "sizeBytes", align: "right" },
  { key: "uploader" },
  { key: "date", sort: "createdAt" },
  { key: "usage", sort: "usageCount", align: "right" },
]

type Props = MediaViewProps & {
  sort: MediaSort
  dir: "asc" | "desc"
  onSort: (sort: MediaSort) => void
}

export function MediaList({
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
  sort,
  dir,
  onSort,
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
  const scrollToIndex = useCallback((i: number) => virtualizer.scrollToIndex(i), [virtualizer])
  const nav = useMediaNav({ items, columns: 1, selection, onOpen, scrollToIndex, containerRef: scrollRef })

  const rows = virtualizer.getVirtualItems()
  const last = rows[rows.length - 1]?.index ?? -1
  useLayoutEffect(() => {
    if (hasMore && !isValidating && last >= items.length - 10) loadMore()
  }, [hasMore, isValidating, last, items.length, loadMore])

  if (isError && items.length === 0) return <LibraryErrorState onRetry={onRetry ?? (() => {})} />
  if (isLoading) return <MediaGridSkeleton />
  if (items.length === 0) return <MediaEmptyState hasActiveFilters={hasActiveFilters} onResetFilters={onResetFilters} />

  const onRowClick = (e: React.MouseEvent, item: MediaListItem) => {
    if (e.shiftKey) selection.range(item.id)
    else if (e.ctrlKey || e.metaKey) selection.toggle(item.id)
    else onOpen(item)
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div
        role="grid"
        aria-multiselectable="true"
        aria-label={t("list.ariaLabel")}
        aria-colcount={COLUMNS.length + 1}
        aria-rowcount={items.length + 1}
        {...nav.containerProps}
      >
      <div role="row" className={cn("sticky top-0 z-10 grid gap-3 border-b border-border bg-background px-4", GRID_COLS)}>
        <div role="columnheader" className="flex h-9 items-center">
          <span className="sr-only">{t("list.columns.select")}</span>
        </div>
        {COLUMNS.map((c) => {
          const label = t(`list.columns.${c.key}`)
          const active = c.sort === sort
          const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown
          return (
            <div
              key={c.key}
              role="columnheader"
              aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : c.sort ? "none" : undefined}
              className={cn("flex h-9 items-center", c.align === "right" && "justify-end")}
            >
              {c.sort ? (
                // Les en-têtes de colonne ne sont pas des actions du registre (tri de la liste).
                <button
                  type="button"
                  data-action-exempt
                  title={t("list.sortBy", { column: label })}
                  onClick={() => onSort(c.sort!)}
                  className={cn(
                    "inline-flex min-h-6 items-center gap-1 rounded-sm text-xs font-medium outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  <Icon className={cn("h-3.5 w-3.5", !active && "opacity-50")} aria-hidden />
                </button>
              ) : (
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
              )}
            </div>
          )
        })}
      </div>
      <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((vr) => {
          const item = items[vr.index]
          const Icon = KIND_ICONS[item.kind]
          const selected = selection.isSelected(item.id)
          const name = item.title || item.filename
          return (
            <div
              key={item.id}
              role="row"
              aria-rowindex={vr.index + 2}
              data-media-row
              data-media-id={item.id}
              data-flagged={flaggedIds?.has(item.id) ? "true" : undefined}
              draggable={Boolean(drag)}
              onDragStart={(e) => startMediaDrag(e, item.id, drag)}
              onDragEnd={drag?.onEnd}
              aria-selected={selected}
              aria-current={currentId === item.id ? "true" : undefined}
              tabIndex={nav.focusedId === item.id ? 0 : -1}
              title={name}
              onClick={(e) => onRowClick(e, item)}
              className={cn(
                "absolute inset-x-0 grid cursor-pointer items-center gap-3 border-b border-border/60 px-4 text-sm outline-none",
                "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                GRID_COLS,
                flaggedIds?.has(item.id) ? "bg-destructive/10" : selected ? "bg-primary/10" : "hover:bg-muted/60",
                currentId === item.id && "bg-accent"
              )}
              style={{ top: vr.start, height: ROW_HEIGHT }}
            >
              <span role="gridcell" className="flex items-center justify-center">
                <input
                  type="checkbox"
                  tabIndex={-1}
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={selected}
                  aria-label={t("list.selectRow", { name })}
                  title={t("list.selectRow", { name })}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => selection.toggle(item.id)}
                />
              </span>
              <span role="gridcell" className="flex min-w-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{name}</span>
                {flaggedIds?.has(item.id) && (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-label={t("bulk.flagged")} />
                )}
              </span>
              <span role="gridcell" className="truncate text-muted-foreground">{t(`kinds.${item.kind}`)}</span>
              <span role="gridcell" className="truncate text-right text-muted-foreground">{formatMediaSize(item.sizeBytes, locale)}</span>
              <span role="gridcell" className="truncate text-muted-foreground">{item.uploaderName}</span>
              <span role="gridcell" className="truncate text-muted-foreground">{formatMediaDate(item.createdAt, locale)}</span>
              <span role="gridcell" className="truncate text-right text-muted-foreground">{item.usageCount}</span>
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
