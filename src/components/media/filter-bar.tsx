"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MediaKind } from "@/lib/db/schema"
import { serializeMediaFilters, type MediaFilters, type MediaSort } from "@/lib/media/filters"
import type { FolderNode } from "@/lib/media/folders"
import { ActionButton } from "./action-button"

export const MEDIA_KINDS: readonly MediaKind[] = ["image", "pdf", "document", "video", "audio", "archive", "other"]
const SORTS: readonly MediaSort[] = ["createdAt", "filename", "sizeBytes", "kind", "usageCount"]
const MB = 1024 * 1024

export type FilterBarProps = {
  filters: MediaFilters
  setFilters: (patch: Partial<MediaFilters>) => void
  reset: () => void
  hasActiveFilters: boolean
  tags: { id: string; label: string; count: number }[]
  folders: Pick<FolderNode, "id" | "parentId" | "name">[]
  spaces: { id: string; name: string }[]
  uploaders: { id: string; name: string }[]
  totalLabel: string
  /** Absents : pas de bascule grille/liste (sélecteur de médias, grille seule). */
  layout?: "grid" | "list"
  onLayoutChange?: (layout: "grid" | "list") => void
  /** Admin d'organisation : propose « Hors espace ». */
  isAdmin?: boolean
  /** Types imposés par un contexte (sélecteur de 1c) ; non fourni en 1b. */
  lockedKinds?: MediaKind[]
  /** Espace imposé par le contexte : le filtre d'espace disparaît. */
  lockedSpace?: boolean
}

const ALL = "__all__"

function toDay(iso?: string): string {
  return iso ? iso.slice(0, 10) : ""
}

export function folderPath(
  folders: Pick<FolderNode, "id" | "parentId" | "name">[],
  folderId?: string
): Pick<FolderNode, "id" | "parentId" | "name">[] {
  if (!folderId || folderId === "none") return []
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: Pick<FolderNode, "id" | "parentId" | "name">[] = []
  const seen = new Set<string>()
  let cur = byId.get(folderId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path
}

function FilterSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  // `items` est recréé à chaque rendu par l'appelant : la correspondance est mémoïsée sur son contenu,
  // car un `items` instable est réécrit dans le store du Select à chaque rendu (boucle de mises à jour).
  const signature = JSON.stringify(items.map((i) => [i.value, i.label]))
  const map = useMemo(() => Object.fromEntries(JSON.parse(signature) as [string, string][]), [signature])
  return (
    <Select value={value} items={map} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger size="sm" aria-label={label} title={label} className="min-h-6">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FilterBar({
  filters,
  setFilters,
  reset,
  hasActiveFilters,
  tags,
  folders,
  spaces,
  uploaders,
  totalLabel,
  layout,
  onLayoutChange,
  isAdmin = false,
  lockedKinds,
  lockedSpace,
}: FilterBarProps) {
  const t = useTranslations("library.filters")
  const ts = useTranslations("library.sort")
  const tp = useTranslations("library.page")
  const [periodError, setPeriodError] = useState(false)
  const [sizeError, setSizeError] = useState(false)
  const [q, setQ] = useState(filters.q ?? "")
  const sentQ = useRef<{ values: Set<string>; last: string | null }>({ values: new Set(), last: null })
  const sizeText = (bytes: number | undefined) => (bytes === undefined ? "" : String(bytes / MB))
  const [minText, setMinText] = useState(sizeText(filters.minSize))
  const [maxText, setMaxText] = useState(sizeText(filters.maxSize))

  // Resynchronise la saisie quand l'URL change ailleurs (réinitialisation, retour arrière),
  // sans écraser une frappe dont l'écho debouncé n'est pas encore arrivé.
  useEffect(() => {
    const cur = filters.q ?? ""
    const sent = sentQ.current
    if (cur === sent.last) {
      sent.values.clear()
      return
    }
    if (sent.values.has(cur)) return
    sent.values.clear()
    sent.last = null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQ(cur)
  }, [filters.q])
  const parseSize = (text: string) => (text === "" ? undefined : Math.round(Number(text) * MB))
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMinText((text) => (parseSize(text) === filters.minSize ? text : sizeText(filters.minSize)))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMaxText((text) => (parseSize(text) === filters.maxSize ? text : sizeText(filters.maxSize)))
  }, [filters.minSize, filters.maxSize])

  const kinds = lockedKinds ?? MEDIA_KINDS
  // Un seul type imposé : le filtre de type n'a rien à proposer.
  const showKinds = !lockedKinds || lockedKinds.length > 1
  const crumbs = folderPath(folders, filters.folderId)
  const hrefFor = (folderId: string) =>
    `?${serializeMediaFilters({ ...filters, folderId, cursor: undefined }).toString()}`

  const onDate = (key: "from" | "to", value: string) => {
    const next = { from: filters.from, to: filters.to, [key]: value || undefined }
    if (next.from && next.to && Date.parse(next.from) > Date.parse(next.to)) {
      setPeriodError(true)
      return
    }
    setPeriodError(false)
    setFilters({ [key]: value || undefined })
  }

  const onSize = (key: "minSize" | "maxSize", value: string) => {
    const bytes = value === "" ? undefined : Math.round(Number(value) * MB)
    if (bytes !== undefined && (!Number.isFinite(bytes) || bytes < 0)) return
    const next = { minSize: filters.minSize, maxSize: filters.maxSize, [key]: bytes }
    if (next.minSize !== undefined && next.maxSize !== undefined && next.minSize > next.maxSize) {
      setSizeError(true)
      return
    }
    setSizeError(false)
    setFilters({ [key]: bytes })
  }

  const spaceItems = [
    { value: ALL, label: t("spaceAny") },
    ...spaces.map((s) => ({ value: s.id, label: s.name })),
    ...(isAdmin ? [{ value: "none", label: t("spaceNone") }] : []),
  ]
  const uploaderItems = [{ value: ALL, label: t("uploaderAny") }, ...uploaders.map((u) => ({ value: u.id, label: u.name }))]
  const sortItems = SORTS.map((s) => ({ value: s, label: ts(s) }))

  const kindLabel = filters.kinds.length ? `${t("type")} (${filters.kinds.length})` : t("type")
  const tagLabel = filters.tagIds.length ? `${t("tags")} (${filters.tagIds.length})` : t("tags")
  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <div role="search" aria-label={t("ariaLabel")} className="space-y-2 border-b border-border px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56" title={t("searchTip")}>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            aria-label={t("search")}
            placeholder={t("search")}
            title={t("searchTip")}
            className="pl-8"
            onChange={(e) => {
              setQ(e.target.value)
              sentQ.current.values.add(e.target.value)
              sentQ.current.last = e.target.value
              setFilters({ q: e.target.value || undefined })
            }}
          />
        </div>

        {showKinds && (
        <Popover>
          <PopoverTrigger
            render={<Button type="button" variant="outline" size="sm" title={t("type")} aria-label={kindLabel} />}
          >
            {kindLabel}
            <ChevronDown aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 space-y-1">
            {kinds.map((k) => (
              <label key={k} className="flex min-h-6 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.kinds.includes(k)}
                  onChange={() => setFilters({ kinds: toggle(filters.kinds, k) })}
                />
                {t(`kinds.${k}`)}
              </label>
            ))}
          </PopoverContent>
        </Popover>
        )}

        <Popover>
          <PopoverTrigger
            render={<Button type="button" variant="outline" size="sm" title={t("tags")} aria-label={tagLabel} />}
          >
            {tagLabel}
            <ChevronDown aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-64 w-56 space-y-1 overflow-auto">
            {tags.length === 0 ? <p className="text-muted-foreground">{t("tagsEmpty")}</p> : null}
            {tags.map((tag) => (
              <label key={tag.id} className="flex min-h-6 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.tagIds.includes(tag.id)}
                  onChange={() => setFilters({ tagIds: toggle(filters.tagIds, tag.id) })}
                />
                <span className="flex-1 truncate">{tag.label}</span>
                <span className="text-xs text-muted-foreground">{tag.count}</span>
              </label>
            ))}
          </PopoverContent>
        </Popover>

        {lockedSpace ? null : (
          <FilterSelect
            label={t("space")}
            value={filters.spaceId ?? ALL}
            items={spaceItems}
            onChange={(v) => setFilters({ spaceId: v === ALL ? undefined : v })}
          />
        )}
        {uploaders.length > 0 ? (
          <FilterSelect
            label={t("uploader")}
            value={filters.uploadedBy ?? ALL}
            items={uploaderItems}
            onChange={(v) => setFilters({ uploadedBy: v === ALL ? undefined : v })}
          />
        ) : null}

        <Popover>
          <PopoverTrigger
            render={<Button type="button" variant="outline" size="sm" title={t("from")} aria-label={`${t("from")} / ${t("to")}`} />}
          >
            {`${t("from")} / ${t("to")}`}
            <ChevronDown aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 space-y-2">
            <label className="block text-xs">
              {t("from")}
              <Input type="date" aria-label={t("from")} value={toDay(filters.from)} onChange={(e) => onDate("from", e.target.value)} />
            </label>
            <label className="block text-xs">
              {t("to")}
              <Input type="date" aria-label={t("to")} value={toDay(filters.to)} onChange={(e) => onDate("to", e.target.value)} />
            </label>
            {periodError ? <p role="alert" className="text-xs text-destructive">{t("periodInvalid")}</p> : null}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger
            render={<Button type="button" variant="outline" size="sm" title={t("minSize")} aria-label={`${t("minSize")} / ${t("maxSize")}`} />}
          >
            {`${t("minSize")} / ${t("maxSize")}`}
            <ChevronDown aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 space-y-2">
            <label className="block text-xs">
              {t("minSize")}
              <Input
                type="number"
                min={0}
                aria-label={t("minSize")}
                value={minText}
                onChange={(e) => {
                  setMinText(e.target.value)
                  onSize("minSize", e.target.value)
                }}
              />
            </label>
            <label className="block text-xs">
              {t("maxSize")}
              <Input
                type="number"
                min={0}
                aria-label={t("maxSize")}
                value={maxText}
                onChange={(e) => {
                  setMaxText(e.target.value)
                  onSize("maxSize", e.target.value)
                }}
              />
            </label>
            {sizeError ? <p role="alert" className="text-xs text-destructive">{t("sizeInvalid")}</p> : null}
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant={filters.view === "unused" ? "secondary" : "outline"}
          size="sm"
          aria-pressed={filters.view === "unused"}
          title={t("unused")}
          onClick={() => setFilters({ view: filters.view === "unused" ? "all" : "unused" })}
        >
          {t("unused")}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <FilterSelect
            label={ts("label")}
            value={filters.sort}
            items={sortItems}
            onChange={(v) => setFilters({ sort: v as MediaSort })}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={ts("toggleDir")}
            aria-sort={filters.dir === "asc" ? "ascending" : "descending"}
            title={`${ts("toggleDir")} (${ts(filters.dir)})`}
            onClick={() => setFilters({ dir: filters.dir === "asc" ? "desc" : "asc" })}
          >
            {filters.dir === "asc" ? <ArrowUpNarrowWide aria-hidden /> : <ArrowDownWideNarrow aria-hidden />}
          </Button>
          {layout && onLayoutChange ? (
            <ActionButton
              id="toggleView"
              variant="outline"
              onAction={() => onLayoutChange(layout === "grid" ? "list" : "grid")}
            />
          ) : null}
          <ActionButton
            id="resetFilters"
            variant="outline"
            disabledReason={hasActiveFilters ? undefined : t("resetDisabled")}
            onAction={reset}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {crumbs.length > 0 ? (
          <nav aria-label={t("breadcrumb")}>
            <ol className="flex items-center gap-1">
              <li className="flex items-center gap-1">
                <a
                  href={`?${serializeMediaFilters({ ...filters, folderId: undefined, cursor: undefined }).toString()}`}
                  className="inline-flex min-h-6 items-center rounded px-1 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={(e) => {
                    e.preventDefault()
                    setFilters({ folderId: undefined })
                  }}
                >
                  {tp("title")}
                </a>
                <span aria-hidden>/</span>
              </li>
              {crumbs.map((c, i) => (
                <li key={c.id} className="flex items-center gap-1">
                  {i > 0 ? <span aria-hidden>/</span> : null}
                  <a
                    href={hrefFor(c.id)}
                    aria-current={i === crumbs.length - 1 ? "page" : undefined}
                    className="inline-flex min-h-6 items-center rounded px-1 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={(e) => {
                      e.preventDefault()
                      setFilters({ folderId: c.id })
                    }}
                  >
                    {c.name}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <span aria-live="polite">{totalLabel}</span>
      </div>
    </div>
  )
}
