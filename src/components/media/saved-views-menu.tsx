"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { toast } from "sonner"
import { Bookmark, ChevronDown, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { serializeMediaFilters, type MediaFilters } from "@/lib/media/filters"
import type { FolderNode } from "@/lib/media/folders"
import { SAVED_VIEWS_PER_USER_MAX, type SavedViewDto } from "@/lib/media/saved-views-limits"
import { ActionButton } from "./action-button"
import { SaveViewDialog, type SaveViewTarget } from "./save-view-dialog"

type ViewsData = { mine: SavedViewDto[]; shared: SavedViewDto[] }

const VIEWS_KEY = "/api/media/views"

async function fetchViews(url: string): Promise<ViewsData> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()) as ViewsData
}

type Translate = (key: string, vars?: Record<string, string>) => string

/** Libellés lisibles d'une chaîne de filtres ; tolérant à un paramètre périmé. */
export function summarizeQuery(
  query: string,
  ctx: {
    folders: Pick<FolderNode, "id" | "name">[]
    tags: { id: string; label: string }[]
    tFilters: Translate
    tSort: Translate
    t: Translate
  }
): string[] {
  const p = new URLSearchParams(query)
  const out: string[] = []
  const folder = p.get("folderId")
  if (folder) out.push(ctx.folders.find((f) => f.id === folder)?.name ?? ctx.t("folderCrit"))
  for (const k of p.getAll("kind")) out.push(ctx.tFilters(`kinds.${k}`))
  for (const id of p.getAll("tagId")) out.push(ctx.tags.find((x) => x.id === id)?.label ?? ctx.t("tagsCrit"))
  if (p.get("view") === "unused") out.push(ctx.t("unusedCrit"))
  const q = p.get("q")
  if (q) out.push(`« ${q} »`)
  const sort = p.get("sort")
  if (sort) out.push(ctx.tSort(sort))
  return out.length ? out : [ctx.t("allMedia")]
}

type Props = {
  filters: MediaFilters
  folders: Pick<FolderNode, "id" | "parentId" | "name">[]
  tags: { id: string; label: string; count: number }[]
  isAdmin?: boolean
  onApplyQuery: (query: string) => void
}

export function SavedViewsMenu({ filters, folders, tags, isAdmin = false, onApplyQuery }: Props) {
  const t = useTranslations("library.views")
  const ta = useTranslations("library.actions")
  const tf = useTranslations("library.filters")
  const ts = useTranslations("library.sort")
  const { data, error, isLoading, mutate } = useSWR<ViewsData>(VIEWS_KEY, fetchViews, { revalidateOnFocus: false })
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<SaveViewTarget | null>(null)

  const currentQuery = useMemo(
    () => serializeMediaFilters({ ...filters, cursor: undefined, limit: undefined }).toString(),
    [filters]
  )
  const mine = data?.mine ?? []
  const shared = data?.shared ?? []
  const all = [...mine, ...shared]
  const active = all.find((v) => v.query === currentQuery)
  const summarize = (q: string) =>
    summarizeQuery(q, {
      folders,
      tags,
      tFilters: tf as Translate,
      tSort: ts as Translate,
      t: t as Translate,
    })

  const maxed = mine.length >= SAVED_VIEWS_PER_USER_MAX
  const saveDisabled = currentQuery === "" ? t("noFilters") : maxed ? t("maxReached", { max: String(SAVED_VIEWS_PER_USER_MAX) }) : undefined
  const canEdit = (v: SavedViewDto) => v.mine || (isAdmin && v.shared)

  const apply = (v: SavedViewDto) => {
    onApplyQuery(v.query)
    setOpen(false)
    toast.info(t("applied", { name: v.name }))
  }

  const remove = async (v: SavedViewDto) => {
    try {
      const res = await fetch(`${VIEWS_KEY}/${v.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      toast.error(t("deleteFailed"))
      return
    }
    void mutate()
    toast.success(t("deleted", { name: v.name }), {
      action: {
        label: ta("undo"),
        onClick: () => {
          void fetch(VIEWS_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: v.name, query: v.query, shared: v.shared }),
          })
            .then((r) => {
              if (!r.ok) throw new Error(String(r.status))
              toast.success(t("restored", { name: v.name }))
            })
            .catch(() => toast.error(t("restoreFailed")))
            .finally(() => void mutate())
        },
      },
    })
  }

  const row = (v: SavedViewDto) => (
    <li key={v.id} className={`flex items-center gap-1 rounded-md ${active?.id === v.id ? "bg-muted" : ""}`}>
      <button
        type="button"
        data-action-exempt
        aria-label={t("applyLabel", { name: v.name })}
        title={t("applyTip")}
        aria-current={active?.id === v.id ? "true" : undefined}
        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => apply(v)}
      >
        <span className="min-w-0 flex-1">
          <b className="block truncate text-sm font-medium">{v.name}</b>
          <small className="block truncate text-xs text-muted-foreground">{summarize(v.query).join(" · ")}</small>
        </span>
        {v.shared ? <Users aria-label={t("sharedBadge")} className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      </button>
      {canEdit(v) ? (
        <>
          <ActionButton
            id="editView"
            label={t("editLabel", { name: v.name })}
            onAction={() => {
              setOpen(false)
              setTarget({ mode: "edit", view: v, criteria: summarize(v.query) })
            }}
          />
          <ActionButton id="deleteView" label={t("deleteLabel", { name: v.name })} onAction={() => void remove(v)} />
        </>
      ) : null}
    </li>
  )

  const triggerLabel = ta("savedViews")

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button type="button" variant={active ? "secondary" : "outline"} size="sm" title={triggerLabel} aria-label={triggerLabel} />}
        >
          <Bookmark aria-hidden />
          <span className="max-w-32 truncate">{active ? active.name : t("title")}</span>
          {!isLoading && !error ? <span className="text-xs text-muted-foreground">{all.length}</span> : null}
          <ChevronDown aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-1 p-2">
          {isLoading ? (
            <div role="status" aria-label={t("loading")} className="space-y-1.5 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-7 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : error ? (
            <div role="alert" className="space-y-1 rounded-md border border-destructive p-2">
              <b className="block text-sm">{t("errorTitle")}</b>
              <span className="block text-xs text-muted-foreground">{t("errorBody")}</span>
              <ActionButton id="retryViews" showLabel size="sm" variant="outline" onAction={() => void mutate()} />
            </div>
          ) : all.length === 0 ? (
            <div className="space-y-1 p-3 text-center text-xs text-muted-foreground">
              <Bookmark aria-hidden className="mx-auto size-5" />
              <b className="block text-sm text-foreground">{t("emptyTitle")}</b>
              {t("emptyBody")}
            </div>
          ) : (
            <>
              {mine.length > 0 ? (
                <section aria-label={t("personal")}>
                  <h4 className="px-2 pt-1 text-xs font-medium text-muted-foreground">{t("personal")}</h4>
                  <ul>{mine.map(row)}</ul>
                </section>
              ) : null}
              {shared.length > 0 ? (
                <section aria-label={t("shared")}>
                  <h4 className="px-2 pt-1 text-xs font-medium text-muted-foreground">{t("shared")}</h4>
                  <ul>{shared.map(row)}</ul>
                </section>
              ) : null}
            </>
          )}
          <hr className="my-1 border-border" />
          <div className="flex">
            <ActionButton
              id="saveView"
              showLabel
              size="sm"
              variant="ghost"
              disabledReason={saveDisabled}
              onAction={() => {
                setOpen(false)
                setTarget({ mode: "create", query: currentQuery, criteria: summarize(currentQuery) })
              }}
            />
          </div>
        </PopoverContent>
      </Popover>
      <SaveViewDialog
        target={target}
        onOpenChange={(o) => {
          if (!o) setTarget(null)
        }}
        ownNames={mine.map((v) => ({ id: v.id, name: v.name }))}
        onSaved={() => void mutate()}
      />
    </>
  )
}
