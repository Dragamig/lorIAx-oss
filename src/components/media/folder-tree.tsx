"use client"

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import {
  Archive,
  ChevronRight,
  Clock,
  EyeOff,
  Folder,
  FolderOpen,
  Images,
  Tag,
  Trash2,
  Unlink,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { MediaFilters } from "@/lib/media/filters"
import type { FolderNode } from "@/lib/media/folders"
import type { LibraryStats } from "@/lib/media/list"
import { ActionButton } from "./action-button"
import { FOLDER_DRAG_MIME } from "./media-drag"
import {
  CreateFolderDialog,
  DeleteFolderDialog,
  MoveFolderDialog,
  RenameFolderDialog,
} from "./folder-dialogs"
import { QuotaGauge } from "./quota-gauge"
import { ZipDownloadButton } from "./zip-download-button"

type Props = {
  folders: FolderNode[]
  stats: LibraryStats
  filters: MediaFilters
  onNavigate: (patch: Partial<MediaFilters>) => void
  /** Dépôt d'un média sur un dossier (`null` = « Sans dossier »). */
  onDropMedia: (folderId: string | null) => void
  /** Un dossier glissé sur un dossier (ou « Sans dossier » = racine). */
  onDropFolder?: (folderId: string, targetParentId: string | null) => void
  onFolderMutated: () => void
  /** Admin d'organisation : voit toujours « Hors espace ». */
  isAdmin?: boolean
  /** Droit d'écriture sur les dossiers (editor et plus). */
  canWrite?: boolean
}

type Row = {
  key: string
  level: number
  label: string
  count?: number
  icon: LucideIcon
  active: boolean
  expanded?: boolean
  hasChildren?: boolean
  folderId?: string | null
  title?: string
  onActivate: () => void
}

export function FolderTree({
  folders,
  stats,
  filters,
  onNavigate,
  onDropMedia,
  onDropFolder,
  onFolderMutated,
  isAdmin = false,
  canWrite = true,
}: Props) {
  const t = useTranslations("library")
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>()
    const byId = new Map(folders.map((f) => [f.id, f]))
    let cur = filters.folderId && filters.folderId !== "none" ? byId.get(filters.folderId) : undefined
    while (cur?.parentId) {
      open.add(cur.parentId)
      cur = byId.get(cur.parentId)
    }
    return open
  })
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const draggedFolder = useRef<string | null>(null)
  const [dialog, setDialog] = useState<"create" | "rename" | "move" | "delete" | null>(null)
  const refs = useRef(new Map<string, HTMLElement>())

  const activeFolder =
    filters.folderId && filters.folderId !== "none"
      ? folders.find((f) => f.id === filters.folderId)
      : undefined

  const rows = useMemo(() => {
    const out: Row[] = []
    const noFolderActive = filters.view === "all" && filters.folderId === "none"
    const fixed = (
      key: string,
      label: string,
      icon: LucideIcon,
      view: MediaFilters["view"],
      count: number,
    ): Row => ({
      key,
      level: 1,
      label,
      count,
      icon,
      active: filters.view === view && !filters.folderId && filters.tagIds.length === 0,
      onActivate: () => onNavigate({ view, folderId: undefined, tagIds: [] }),
    })
    out.push(fixed("all", t("tree.allMedia"), Images, "all", stats.total))
    out.push({
      key: "none",
      level: 1,
      label: t("tree.noFolder"),
      count: stats.noFolder,
      icon: Unlink,
      active: noFolderActive,
      folderId: null,
      onActivate: () => onNavigate({ view: "all", folderId: "none", tagIds: [] }),
    })
    out.push(fixed("unused", t("tree.unused"), EyeOff, "unused", stats.unused))
    out.push(fixed("mine", t("tree.mine"), Clock, "mine", stats.mine))
    out.push(fixed("trash", t("tree.trash"), Trash2, "trash", stats.trash))
    if (stats.orphan > 0 && isAdmin) {
      out.push(fixed("orphan", t("tree.orphan"), Archive, "orphan", stats.orphan))
    }

    const kids = new Map<string | null, FolderNode[]>()
    for (const f of folders) {
      const list = kids.get(f.parentId) ?? []
      list.push(f)
      kids.set(f.parentId, list)
    }
    const walk = (parent: string | null, level: number) => {
      for (const f of kids.get(parent) ?? []) {
        const hasChildren = (kids.get(f.id) ?? []).length > 0
        const isOpen = expanded.has(f.id)
        out.push({
          key: `f:${f.id}`,
          level,
          label: f.name,
          count: f.mediaCount,
          icon: isOpen ? FolderOpen : Folder,
          active: filters.view === "all" && filters.folderId === f.id,
          expanded: hasChildren ? isOpen : undefined,
          hasChildren,
          folderId: f.id,
          title: f.name,
          onActivate: () => onNavigate({ view: "all", folderId: f.id, tagIds: [] }),
        })
        if (hasChildren && isOpen) walk(f.id, level + 1)
      }
    }
    walk(null, 2)

    for (const tag of stats.byTag) {
      const on = filters.tagIds.includes(tag.id)
      out.push({
        key: `t:${tag.id}`,
        level: 1,
        label: tag.label,
        count: tag.count,
        icon: Tag,
        active: on,
        title: on ? t("tree.removeTag", { label: tag.label }) : t("tree.filterTag", { label: tag.label }),
        onActivate: () =>
          onNavigate({ tagIds: on ? filters.tagIds.filter((x) => x !== tag.id) : [...filters.tagIds, tag.id] }),
      })
    }
    return out
  }, [folders, stats, filters, expanded, isAdmin, onNavigate, t])

  const activeKey = rows.find((r) => r.active)?.key
  const tabKey = rows.some((r) => r.key === focusKey) ? focusKey : (activeKey ?? rows[0]?.key)
  const folderStart = rows.findIndex((r) => r.key.startsWith("f:"))
  const tagStart = rows.findIndex((r) => r.key.startsWith("t:"))

  const focusRow = (key: string | undefined) => {
    if (!key) return
    setFocusKey(key)
    refs.current.get(key)?.focus()
  }

  const toggle = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, row: Row, index: number) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        focusRow(rows[Math.min(rows.length - 1, index + 1)]?.key)
        break
      case "ArrowUp":
        e.preventDefault()
        focusRow(rows[Math.max(0, index - 1)]?.key)
        break
      case "Home":
        e.preventDefault()
        focusRow(rows[0]?.key)
        break
      case "End":
        e.preventDefault()
        focusRow(rows[rows.length - 1]?.key)
        break
      case "ArrowRight":
        if (row.folderId && row.hasChildren) {
          e.preventDefault()
          if (!row.expanded) toggle(row.folderId, true)
          else focusRow(rows[index + 1]?.key)
        }
        break
      case "ArrowLeft":
        if (row.folderId && row.hasChildren && row.expanded) {
          e.preventDefault()
          toggle(row.folderId, false)
        } else if (row.level > 1 && row.folderId) {
          e.preventDefault()
          const parent = [...rows.slice(0, index)].reverse().find((r) => r.level < row.level)
          focusRow(parent?.key)
        }
        break
      case "Enter":
      case " ":
        e.preventDefault()
        row.onActivate()
        break
    }
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files")

  const dropProps = (row: Row) => {
    if (row.folderId === undefined || !canWrite) return {}
    return {
      onDragOver: (e: DragEvent) => {
        if (hasFiles(e)) return
        e.preventDefault()
        if (dropKey !== row.key) setDropKey(row.key)
      },
      onDragLeave: () => setDropKey((k) => (k === row.key ? null : k)),
      onDrop: (e: DragEvent) => {
        if (hasFiles(e)) return
        e.preventDefault()
        setDropKey(null)
        const target = row.folderId ?? null
        const dragged = draggedFolder.current
        draggedFolder.current = null
        if (dragged) {
          if (dragged !== target) onDropFolder?.(dragged, target)
        } else onDropMedia(target)
      },
    }
  }

  const dragProps = (row: Row) => {
    if (!row.folderId || !canWrite) return {}
    const id = row.folderId
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        draggedFolder.current = id
        e.dataTransfer?.setData(FOLDER_DRAG_MIME, id)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
      },
      onDragEnd: () => {
        draggedFolder.current = null
      },
    }
  }

  const writeReason = canWrite ? undefined : t("folders.readOnly")
  const noFolderSelected = activeFolder ? undefined : t("tree.selectFolder")
  const subtreeCount = (id: string): number =>
    (folders.find((f) => f.id === id)?.mediaCount ?? 0) +
    folders.filter((f) => f.parentId === id).reduce((n, f) => n + subtreeCount(f.id), 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b border-border p-1.5">
        <ActionButton id="newFolder" disabledReason={writeReason} onAction={() => setDialog("create")} />
        <ActionButton
          id="renameFolder"
          disabledReason={writeReason ?? noFolderSelected}
          onAction={() => setDialog("rename")}
        />
        <ActionButton
          id="moveFolder"
          disabledReason={writeReason ?? noFolderSelected}
          onAction={() => setDialog("move")}
        />
        <ActionButton
          id="deleteFolder"
          disabledReason={writeReason ?? noFolderSelected}
          onAction={() => setDialog("delete")}
        />
        <ZipDownloadButton
          variant="tree"
          source={{ folderId: activeFolder?.id ?? "" }}
          folderName={activeFolder?.name}
          fileCount={activeFolder ? subtreeCount(activeFolder.id) : 0}
          disabledReason={noFolderSelected ?? (activeFolder && subtreeCount(activeFolder.id) === 0 ? t("zip.emptyFolder") : undefined)}
        />
      </div>

      <ul role="tree" aria-label={t("tree.ariaLabel")} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {rows.map((row, index) => {
          const Icon = row.icon
          return (
            <li key={row.key} role="none">
              {index === folderStart && (
                <p className="px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("tree.shared")}
                </p>
              )}
              {index === tagStart && (
                <p className="px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("tree.tags")}
                </p>
              )}
              <div
                role="treeitem"
                aria-level={row.level}
                aria-selected={row.active}
                aria-expanded={row.expanded}
                aria-label={row.key.startsWith("t:") ? row.title : undefined}
                title={row.title}
                tabIndex={row.key === tabKey ? 0 : -1}
                data-key={row.key}
                ref={(el) => {
                  if (el) refs.current.set(row.key, el)
                  else refs.current.delete(row.key)
                }}
                onFocus={() => setFocusKey(row.key)}
                onClick={row.onActivate}
                onKeyDown={(e) => onKeyDown(e, row, index)}
                {...dropProps(row)}
                {...dragProps(row)}
                style={{ paddingLeft: 8 + (row.level > 2 ? (row.level - 2) * 14 : 0) }}
                className={cn(
                  "flex min-h-7 cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  row.active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
                  dropKey === row.key && "ring-2 ring-primary",
                )}
              >
                {row.hasChildren ? (
                  <ChevronRight
                    aria-hidden="true"
                    className={cn("size-3.5 shrink-0 transition-transform", row.expanded && "rotate-90")}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (row.folderId) toggle(row.folderId, !row.expanded)
                    }}
                  />
                ) : row.level > 1 && row.folderId ? (
                  <span className="size-3.5 shrink-0" aria-hidden="true" />
                ) : null}
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.count !== undefined && (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.count}</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <QuotaGauge stats={stats} />

      <CreateFolderDialog
        open={dialog === "create"}
        onOpenChange={(o) => setDialog(o ? "create" : null)}
        parentId={activeFolder?.id ?? null}
        onDone={onFolderMutated}
      />
      {activeFolder && (
        <>
          <RenameFolderDialog
            open={dialog === "rename"}
            onOpenChange={(o) => setDialog(o ? "rename" : null)}
            folder={activeFolder}
            onDone={onFolderMutated}
          />
          <MoveFolderDialog
            open={dialog === "move"}
            onOpenChange={(o) => setDialog(o ? "move" : null)}
            folder={activeFolder}
            folders={folders}
            onDone={onFolderMutated}
          />
          <DeleteFolderDialog
            open={dialog === "delete"}
            onOpenChange={(o) => setDialog(o ? "delete" : null)}
            folder={activeFolder}
            onDone={() => {
              onNavigate({ view: "all", folderId: undefined })
              onFolderMutated()
            }}
          />
        </>
      )}
    </div>
  )
}
