"use client"

import { useCallback, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { toast } from "sonner"
import type { MediaKind } from "@/lib/db/schema"
import { parseMediaFilters, type MediaFilters } from "@/lib/media/filters"
import type { FolderNode } from "@/lib/media/folders"
import type { MediaListItem } from "@/lib/media/list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterBar } from "../filter-bar"
import { MediaGrid } from "../media-grid"
import { useMediaList } from "../use-media-list"
import type { Selection } from "../use-selection"
import type { PickedMedia } from "./types"
import type { PickerSelection } from "./use-picker-selection"

const ALL = "__all__"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export function toPicked(item: MediaListItem): PickedMedia {
  return {
    id: item.id,
    url: `/api/media/${item.id}`,
    filename: item.filename,
    title: item.title,
    altText: item.altText,
    mimeType: item.mimeType,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
  }
}

type Props = {
  accept?: MediaKind[]
  mode: "single" | "multiple"
  max?: number
  picker: PickerSelection
  /** Espace du contexte : seuls ses médias sont proposés (les autres seraient « manquants » pour d'autres lecteurs). */
  spaceId?: string | null
}

type FolderOption = { id: string; name: string; depth: number }

function flattenFolders(folders: Pick<FolderNode, "id" | "parentId" | "name">[]): FolderOption[] {
  const byParent = new Map<string | null, Pick<FolderNode, "id" | "parentId" | "name">[]>()
  for (const f of folders) byParent.set(f.parentId ?? null, [...(byParent.get(f.parentId ?? null) ?? []), f])
  const out: FolderOption[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push({ id: f.id, name: f.name, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Onglet Médiathèque : recherche, dossier, filtres et grille compacte, types imposés par `accept`. */
export function PickerLibrary({ accept, mode, max, picker, spaceId }: Props) {
  const t = useTranslations("library")
  const tp = useTranslations("library.picker")
  const [filters, setFiltersState] = useState<MediaFilters>(() => parseMediaFilters(new URLSearchParams()))
  const setFilters = useCallback((patch: Partial<MediaFilters>) => setFiltersState((f) => ({ ...f, ...patch })), [])
  const reset = useCallback(() => setFiltersState(parseMediaFilters(new URLSearchParams())), [])

  const locked = accept && accept.length > 0 ? accept : undefined
  // Les types acceptés bornent toujours la requête, quoi que choisisse l'utilisateur.
  const forced = useMemo<Partial<MediaFilters> | undefined>(() => {
    const out: Partial<MediaFilters> = {}
    if (locked) {
      const chosen = filters.kinds.filter((k) => locked.includes(k))
      out.kinds = chosen.length ? chosen : locked
    }
    if (spaceId) out.spaceId = spaceId
    return Object.keys(out).length ? out : undefined
  }, [locked, filters.kinds, spaceId])

  const list = useMediaList(filters, forced)
  const stats = useSWR<{ byTag: { id: string; label: string; count: number }[] }>("/api/media/stats", fetchJson, {
    revalidateOnFocus: false,
  })
  const folderData = useSWR<{ folders: FolderNode[] }>("/api/media/folders", fetchJson, { revalidateOnFocus: false })
  const spaceData = useSWR<{ id: string; name: string }[]>("/api/spaces", fetchJson, { revalidateOnFocus: false })
  const folders = useMemo(() => folderData.data?.folders ?? [], [folderData.data])
  const spaces = useMemo(
    () => (Array.isArray(spaceData.data) ? spaceData.data.map((s) => ({ id: s.id, name: s.name })) : []),
    [spaceData.data]
  )
  const uploaders = useMemo(() => {
    const seen = new Map<string, string>()
    for (const i of list.items) if (i.uploadedBy && i.uploaderName) seen.set(i.uploadedBy, i.uploaderName)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [list.items])

  const byId = useMemo(() => new Map(list.items.map((i) => [i.id, i])), [list.items])
  const toggleId = useCallback(
    (id: string) => {
      const item = byId.get(id)
      if (!item) return
      if (mode === "multiple" && !picker.isSelected(id) && picker.atMax) {
        toast.error(tp("maxReached", { max: String(max ?? picker.selected.length) }))
        return
      }
      picker.toggle(toPicked(item))
    },
    [byId, mode, max, picker, tp]
  )

  // Adaptateur vers la sélection attendue par la grille : un clic ou Entrée coche, Échap ne vide rien.
  const selection = useMemo<Selection>(
    () => ({
      selected: new Set(picker.selected.map((s) => s.id)),
      anchorId: null,
      toggle: toggleId,
      range: toggleId,
      all: () => {},
      clear: () => {},
      keepOnly: () => {},
      isSelected: picker.isSelected,
    }),
    [picker, toggleId]
  )

  const folderOptions = useMemo(() => flattenFolders(folders), [folders])
  const folderItems = useMemo(
    () => ({
      [ALL]: tp("folderAll"),
      none: tp("folderNone"),
      ...Object.fromEntries(folderOptions.map((f) => [f.id, `${"  ".repeat(f.depth)}${f.name}`])),
    }),
    [folderOptions, tp]
  )

  const hasActiveFilters =
    !!filters.q ||
    filters.kinds.length > 0 ||
    filters.tagIds.length > 0 ||
    !!filters.spaceId ||
    !!filters.folderId ||
    !!filters.uploadedBy ||
    !!filters.from ||
    !!filters.to ||
    filters.minSize !== undefined ||
    filters.maxSize !== undefined ||
    filters.view !== "all"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-sm text-muted-foreground">{tp("folder")}</span>
        <Select
          value={filters.folderId ?? ALL}
          items={folderItems}
          onValueChange={(v) => v && setFilters({ folderId: v === ALL ? undefined : v })}
        >
          <SelectTrigger size="sm" aria-label={tp("folder")} title={tp("folder")} className="min-h-6 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(folderItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        lockedKinds={locked}
        lockedSpace={!!spaceId}
      />
      <div className="min-h-0 flex-1">
        <MediaGrid
          compact
          items={list.items}
          selection={selection}
          currentId={null}
          onOpen={(item) => toggleId(item.id)}
          hasMore={list.hasMore}
          loadMore={list.loadMore}
          isValidating={list.isValidating}
          isLoading={list.isLoading}
          isError={list.isError}
          onRetry={() => void list.mutate()}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={reset}
        />
      </div>
    </div>
  )
}
