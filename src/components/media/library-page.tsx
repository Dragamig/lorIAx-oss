"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { UploadCloud } from "lucide-react"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import type { MediaFilters, MediaSort } from "@/lib/media/filters"
import type { FolderNode } from "@/lib/media/folders"
import type { LibraryStats, MediaListItem } from "@/lib/media/list"
import { ActionButton } from "./action-button"
import { BulkBar } from "./bulk-bar"
import { FilterBar, folderPath } from "./filter-bar"
import { FolderTree } from "./folder-tree"
import type { MediaDrag } from "./media-drag"
import { MediaGrid } from "./media-grid"
import { MediaList } from "./media-list"
import { MoveDialog } from "./move-dialog"
import { PreviewDialog } from "./preview-dialog"
import { PropertiesPanel } from "./properties-panel"
import { LibraryErrorState } from "./media-states"
import { isQuotaFull, QuotaBanner } from "./quota-banner"
import { TagsDialog } from "./tags-dialog"
import { EraseDialog, type EraseTarget } from "./erase-dialog"
import { TrashDialog } from "./trash-dialog"
import { TrashView } from "./trash-view"
import { UploadDialog } from "./upload-dialog"
import { UploadTray } from "./upload-tray"
import { useBulkActions } from "./use-bulk-actions"
import { useLibraryDeeplink } from "./use-library-deeplink"
import { useLibraryFilters } from "./use-library-filters"
import { useMediaList } from "./use-media-list"
import { useSelection } from "./use-selection"
import { useUndoStack } from "./use-undo-stack"
import { useUploadQueue } from "./use-upload-queue"

export { LibraryErrorState }

export function LibraryPageSkeleton() {
  const t = useTranslations("library.states")
  return (
    <div className="flex h-full" role="status" aria-label={t("loading")}>
      <aside className="hidden w-60 shrink-0 space-y-2 border-r border-border p-3 md:block">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </aside>
      <div className="flex-1 space-y-3 p-4">
        <Skeleton className="h-9 w-full" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-3">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-[232px]" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Emplacements de la coque à trois colonnes. */
export type LibrarySlots = {
  tree?: ReactNode
  toolbar?: ReactNode
  properties?: ReactNode
  /** Bandeau de quota, sous la barre d'outils. */
  banner?: ReactNode
}

/**
 * Coque à trois colonnes, sans donnée : le centre (`children`) est rendu par les
 * vues, qui portent seules les états vide, de chargement et d'erreur.
 */
export function LibraryLayout({
  slots = {},
  children,
  onFilesDropped,
  dropFolderLabel,
  dropDisabledReason,
  onItemDoubleClick,
}: {
  slots?: LibrarySlots
  children?: ReactNode
  /** Dépôt de fichiers sur la zone centrale (B9). */
  onFilesDropped?: (files: File[]) => void
  /** Dossier courant, nommé dans la surcouche de dépôt. */
  dropFolderLabel?: string
  /** Quand défini, le dépôt est refusé (quota atteint). */
  dropDisabledReason?: string
  /** Double-clic sur une tuile ou une ligne : reçoit l'identifiant du média. */
  onItemDoubleClick?: (id: string) => void
}) {
  const t = useTranslations("library")
  const [dragging, setDragging] = useState(false)
  const dropEnabled = Boolean(onFilesDropped) && !dropDisabledReason
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files")
  const dropHandlers = onFilesDropped
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          if (dropEnabled) setDragging(true)
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        },
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragging(false)
          const files = Array.from(e.dataTransfer.files)
          if (files.length === 0) return
          if (dropEnabled) onFilesDropped?.(files)
          else if (dropDisabledReason) toast.error(dropDisabledReason)
        },
      }
    : {}

  return (
    <div className="flex h-full min-h-0">
      {slots.tree && (
        <aside aria-label={t("page.allMedia")} className="hidden w-60 shrink-0 overflow-y-auto border-r border-border md:block">
          {slots.tree}
        </aside>
      )}
      <section aria-label={t("page.title")} className="flex min-w-0 flex-1 flex-col">
        {slots.toolbar}
        {slots.banner}
        <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="library-center"
          onDoubleClick={(e) => {
            const id = (e.target as HTMLElement).closest<HTMLElement>("[data-media-id]")?.dataset.mediaId
            if (id) onItemDoubleClick?.(id)
          }}
          {...dropHandlers}
        >
          {children}
          {dragging && (
            <div
              data-testid="drop-overlay"
              className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary"
            >
              <UploadCloud className="h-5 w-5" aria-hidden />
              {t("upload.dropOverlay", { folder: dropFolderLabel ?? t("upload.folderRoot") })}
            </div>
          )}
        </div>
      </section>
      {slots.properties && (
        <aside aria-label={t("page.properties")} className="w-80 shrink-0 overflow-y-auto border-l border-border">
          {slots.properties}
        </aside>
      )}
    </div>
  )
}

const LAYOUT_KEY = "library.layout"
const SHOW_ALL: Partial<MediaFilters> = {
  view: "all",
  folderId: undefined,
  spaceId: undefined,
  q: undefined,
  kinds: [],
  tagIds: [],
  uploadedBy: undefined,
  from: undefined,
  to: undefined,
  minSize: undefined,
  maxSize: undefined,
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

type SpaceRow = { id: string; name: string }

export function LibraryPage({ isAdmin = false, canWrite = true }: { isAdmin?: boolean; canWrite?: boolean }) {
  const t = useTranslations("library")
  const { filters, setFilters, reset, hasActiveFilters } = useLibraryFilters()
  const list = useMediaList(filters)
  const stats = useSWR<LibraryStats>("/api/media/stats", fetchJson, { revalidateOnFocus: false })
  const folderData = useSWR<{ folders: FolderNode[] }>("/api/media/folders", fetchJson, { revalidateOnFocus: false })
  const spaceData = useSWR<SpaceRow[]>("/api/spaces", fetchJson, { revalidateOnFocus: false })
  const folders = useMemo(() => folderData.data?.folders ?? [], [folderData.data])
  const spaces = useMemo(
    () => (Array.isArray(spaceData.data) ? spaceData.data.map((s) => ({ id: s.id, name: s.name })) : []),
    [spaceData.data]
  )

  const [layout, setLayout] = useState<"grid" | "list">("grid")
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAYOUT_KEY)
      if (saved === "grid" || saved === "list") setLayout(saved)
    } catch {
      /* stockage indisponible */
    }
  }, [])
  const changeLayout = useCallback((next: "grid" | "list") => {
    setLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      /* stockage indisponible */
    }
  }, [])

  const orderedIds = useMemo(() => list.items.map((i) => i.id), [list.items])
  const selection = useSelection(orderedIds)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const onOpen = useCallback((item: MediaListItem) => setCurrentId(item.id), [])

  const onSort = (sort: MediaSort) => {
    if (sort === filters.sort) setFilters({ dir: filters.dir === "asc" ? "desc" : "asc" })
    else setFilters({ sort, dir: sort === "filename" || sort === "kind" ? "asc" : "desc" })
  }

  const uploaders = useMemo(() => {
    const seen = new Map<string, string>()
    for (const i of list.items) if (i.uploadedBy && i.uploaderName) seen.set(i.uploadedBy, i.uploaderName)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [list.items])

  const queue = useUploadQueue()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [dropped, setDropped] = useState<File[] | undefined>(undefined)
  const quotaFull = isQuotaFull(stats.data)
  const folderId = filters.folderId && filters.folderId !== "none" ? filters.folderId : null
  const spaceId = filters.spaceId && filters.spaceId !== "none" ? filters.spaceId : null
  const currentFolder = folderPath(folders, folderId ?? undefined).at(-1)

  const mutateList = list.mutate
  const mutateStats = stats.mutate
  const mutateFolders = folderData.mutate
  const refreshAll = useCallback(() => {
    void mutateList()
    void mutateStats()
    void mutateFolders()
  }, [mutateList, mutateStats, mutateFolders])

  const undo = useUndoStack()
  const bulk = useBulkActions({ items: list.items, selection, undo, onChanged: refreshAll })
  const [moveOpen, setMoveOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewPos = previewId ? list.items.findIndex((x) => x.id === previewId) : -1
  const previewIndex = previewPos >= 0 ? previewPos : null
  // Le média ouvert a disparu de la liste (corbeille, filtre, déplacement) : l'aperçu se ferme.
  useEffect(() => {
    if (previewId && previewPos < 0) setPreviewId(null)
  }, [previewId, previewPos])
  const inTrash = filters.view === "trash"
  const selectedIds = useMemo(() => orderedIds.filter((id) => selection.selected.has(id)), [orderedIds, selection.selected])
  const selectedItems = useMemo(() => list.items.filter((i) => selection.selected.has(i.id)), [list.items, selection.selected])
  const [eraseTargets, setEraseTargets] = useState<EraseTarget[]>([])
  const openErase = useCallback(
    (ids: string[]) =>
      setEraseTargets(
        list.items
          .filter((i) => ids.includes(i.id))
          .map((i) => ({ id: i.id, name: i.filename, affected: i.affectedCount ?? i.usageCount ?? 0 }))
      ),
    [list.items]
  )

  // Glisser-déposer : les ids glissés vivent dans un ref (le dépôt a lieu dans l'arbre).
  const dragIds = useRef<string[]>([])
  const drag = useMemo<MediaDrag>(
    () => ({
      idsFor: (id) => (selection.isSelected(id) ? selectedIds : [id]),
      onStart: (ids) => {
        dragIds.current = ids
      },
      onEnd: () => {
        dragIds.current = []
      },
    }),
    [selection, selectedIds]
  )
  const dropMedia = (target: string | null) => {
    const ids = dragIds.current
    dragIds.current = []
    if (ids.length > 0) void bulk.move(ids, target)
  }
  const dropFolder = (id: string, parentId: string | null) => {
    const folder = folders.find((f) => f.id === id)
    if (folder) void bulk.moveFolder(folder, parentId)
  }

  const canWriteRef = canWrite
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (!undo.canUndo()) return
        e.preventDefault()
        void undo.undoLast()
      } else if (e.key === "Delete" && selectedIds.length > 0 && canWriteRef && !inTrash) {
        e.preventDefault()
        setTrashOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo, selectedIds.length, canWriteRef, inTrash])

  useLibraryDeeplink({
    ids: filters.ids,
    items: list.items,
    canUpload: !quotaFull,
    onUpload: () => setUploadOpen(true),
    onOpen: setCurrentId,
  })

  const closeUpload = () => {
    setUploadOpen(false)
    setDropped(undefined)
  }

  const tree =
    stats.data && folderData.data ? (
      <FolderTree
        folders={folders}
        stats={stats.data}
        filters={filters}
        onNavigate={setFilters}
        onDropMedia={dropMedia}
        onDropFolder={dropFolder}
        onFolderMutated={refreshAll}
        isAdmin={isAdmin}
        canWrite={canWrite}
      />
    ) : (
      <div className="space-y-2 p-3" role="status" aria-label={t("states.loading")}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    )

  const toolbar = (
    <div className="space-y-2 border-b border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("page.title")}</h1>
        <ActionButton
          id="upload"
          variant="default"
          size="sm"
          showLabel
          disabledReason={quotaFull ? t("upload.quotaFull") : undefined}
          onAction={() => setUploadOpen(true)}
        />
      </div>
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        reset={reset}
        hasActiveFilters={hasActiveFilters}
        tags={stats.data?.byTag ?? []}
        folders={folders}
        spaces={spaces}
        uploaders={uploaders}
        totalLabel={t("page.count", { count: list.items.length })}
        layout={layout}
        onLayoutChange={changeLayout}
        isAdmin={isAdmin}
      />
      <BulkBar
        selectedCount={selection.selected.size}
        totalCount={orderedIds.length}
        onSelectAll={selection.all}
        onClear={selection.clear}
        onMove={() => setMoveOpen(true)}
        onTags={() => setTagsOpen(true)}
        onTrash={() => setTrashOpen(true)}
        onRestore={inTrash ? () => void bulk.restore(selectedIds) : undefined}
        onErase={inTrash && isAdmin ? () => openErase(selectedIds) : undefined}
        writeDisabledReason={canWrite ? undefined : t("bulk.readOnly")}
      />
    </div>
  )

  const viewProps = {
    flaggedIds: bulk.flaggedIds,
    drag,
    items: list.items,
    selection,
    currentId,
    onOpen,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
    isValidating: list.isValidating,
    isLoading: list.isLoading,
    isError: list.isError,
    onRetry: () => void list.mutate(),
    hasActiveFilters,
    onResetFilters: reset,
  }

  return (
    <>
      <LibraryLayout
        slots={{
          tree,
          toolbar,
          banner: <QuotaBanner stats={stats.data} />,
          properties: currentId && !inTrash ? (
            <PropertiesPanel
              mediaId={currentId}
              onClose={() => setCurrentId(null)}
              onMutated={refreshAll}
              spaces={spaces}
              undo={undo}
              onTrashed={bulk.trashed}
              onPreview={(id) => {
                if (list.items.some((x) => x.id === id)) setPreviewId(id)
              }}
            />
          ) : undefined,
        }}
        onFilesDropped={(files) => {
          setDropped(files)
          setUploadOpen(true)
        }}
        onItemDoubleClick={(id) => {
          const i = list.items.findIndex((x) => x.id === id)
          if (i >= 0) setPreviewId(list.items[i].id)
        }}
        dropFolderLabel={currentFolder?.name}
        dropDisabledReason={quotaFull ? t("upload.quotaFull") : undefined}
      >
        {inTrash ? (
          <TrashView
            items={list.items}
            selection={selection}
            flaggedIds={bulk.flaggedIds}
            hasMore={list.hasMore}
            loadMore={list.loadMore}
            isValidating={list.isValidating}
            isLoading={list.isLoading}
            isError={list.isError}
            onRetry={() => void list.mutate()}
            onRestore={(ids) => void bulk.restore(ids)}
            onErase={isAdmin ? openErase : undefined}
            writeDisabledReason={canWrite ? undefined : t("bulk.readOnly")}
          />
        ) : layout === "list" ? (
          <MediaList {...viewProps} sort={filters.sort} dir={filters.dir} onSort={onSort} />
        ) : (
          <MediaGrid {...viewProps} />
        )}
      </LibraryLayout>
      <PreviewDialog
        items={list.items}
        index={inTrash ? null : previewIndex}
        onIndexChange={(i) => setPreviewId(list.items[i]?.id ?? null)}
        onClose={() => setPreviewId(null)}
      />
      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        folders={folders}
        currentFolderId={folderId}
        onMove={(target) => void bulk.move(selectedIds, target)}
      />
      <TagsDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        items={selectedItems}
        onApply={(add, removeIds) => void bulk.applyTags(selectedIds, add, removeIds)}
      />
      <EraseDialog
        open={eraseTargets.length > 0}
        onOpenChange={(o) => !o && setEraseTargets([])}
        targets={eraseTargets}
        onDone={({ erasedIds, failedIds }) => {
          bulk.settle(erasedIds, failedIds)
          setEraseTargets([])
        }}
      />
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        ids={selectedIds}
        publicShared={selectedItems.some((i) => i.publicShared)}
        onTrashed={bulk.trashed}
        onDone={() => {}}
      />
      <UploadDialog
        open={uploadOpen}
        onClose={closeUpload}
        queue={queue}
        target={{ spaceId, folderId }}
        spaces={spaces}
        folders={folders}
        isAdmin={isAdmin}
        stats={stats.data}
        initialFiles={dropped}
        onShowAdded={(ids) => {
          setFilters({ ...SHOW_ALL, ids })
          closeUpload()
        }}
      />
      <UploadTray queue={queue} hidden={uploadOpen} onOpen={() => setUploadOpen(true)} onMutated={refreshAll} />
    </>
  )
}
