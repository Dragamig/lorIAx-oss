"use client"

import { useCallback, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { BatchItemResult } from "@/lib/media/batch"
import type { MediaListItem } from "@/lib/media/list"
import { normalizeTag, postBatch } from "./bulk-api"
import type { Selection } from "./use-selection"
import type { UndoStack } from "./use-undo-stack"

type Options = {
  /** Médias chargés : sert à retrouver les libellés des tags à rétablir. */
  items: MediaListItem[]
  selection: Selection
  undo: UndoStack
  /** Rafraîchit liste, compteurs et arbre après toute écriture, annulation comprise. */
  onChanged: () => void
}

const groupBy = <T,>(rows: T[], keyOf: (r: T) => string) => {
  const out = new Map<string, T[]>()
  for (const r of rows) out.set(keyOf(r), [...(out.get(keyOf(r)) ?? []), r])
  return [...out.values()]
}

/**
 * Gestes de lot (déplacement, tags). Chaque geste lit les résultats par élément :
 * un refus reste sélectionné et marqué, « Annuler » ne touche que les réussis et
 * replace chacun sur son état d'origine.
 */
export function useBulkActions({ items, selection, undo, onChanged }: Options) {
  const t = useTranslations("library")
  const [flagged, setFlagged] = useState<string[]>([])
  const { keepOnly } = selection

  const flaggedIds = useMemo(() => new Set(flagged.filter((id) => selection.selected.has(id))), [flagged, selection.selected])

  /** Empile une annulation et rend l'action du toast, à rattacher au toast posé. */
  const undoable = useCallback(
    (revert: () => Promise<void>, ids: string[] = []) => {
      const entry = undo.push(async () => {
        try {
          await revert()
          toast.success(t("bulk.undone"))
        } catch {
          toast.error(t("bulk.undoFailed"))
        }
        onChanged()
      }, ids)
      return {
        action: {
          label: t("actions.undo"),
          onClick: () =>
            void undo.tryRun(entry).then((ran) => {
              if (!ran) toast.info(t("bulk.undoStale"))
            }),
        },
        attach: (toastId: string | number) => {
          entry.dismiss = () => toast.dismiss(toastId)
        },
      }
    },
    [onChanged, t, undo]
  )

  /**
   * Fin d'un geste de lot : les réussis quittent la sélection, les refusés y
   * restent (ou y entrent) et sont marqués ; liste, compteurs et arbre sont relus.
   */
  const settle = useCallback(
    (okIds: string[], failedIds: string[]) => {
      const done = new Set(okIds)
      keepOnly([...new Set([...[...selection.selected].filter((id) => !done.has(id)), ...failedIds])])
      setFlagged(failedIds)
      onChanged()
    },
    [keepOnly, onChanged, selection.selected]
  )

  /** Pose le toast final et empile l'annulation. */
  const announce = useCallback(
    (opts: {
      okIds: string[]
      failedIds: string[]
      success: string
      partial: string
      revert: (() => Promise<void>) | null
    }) => {
      settle(opts.okIds, opts.failedIds)
      const u = opts.revert ? undoable(opts.revert, opts.okIds) : null
      const extra = u ? { action: u.action } : {}
      const id =
        opts.failedIds.length > 0 ? toast.error(opts.partial, extra) : toast.success(opts.success, extra)
      u?.attach(id)
    },
    [settle, undoable]
  )

  const moveFolder = useCallback(
    async (folder: { id: string; name: string; parentId: string | null }, parentId: string | null) => {
      if (folder.parentId === parentId) return
      const call = (target: string | null) =>
        fetch(`/api/media/folders/${folder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: target }),
        })
      const res = await call(parentId).catch(() => null)
      if (!res?.ok) {
        const body = (await res?.json().catch(() => ({}))) as { error?: unknown } | undefined
        toast.error(typeof body?.error === "string" ? body.error : t("bulk.folderMoveFailed"))
        return
      }
      onChanged()
      const u = undoable(async () => {
        const back = await call(folder.parentId)
        if (!back.ok) throw new Error(`HTTP ${back.status}`)
      }, [folder.id])
      u.attach(toast.success(t("folders.toasts.moved", { name: folder.name }), { action: u.action }))
    },
    [onChanged, t, undoable]
  )

  const move = useCallback(
    async (ids: string[], folderId: string | null) => {
      let results: BatchItemResult[]
      try {
        results = await postBatch({ action: "move", folderId }, ids)
      } catch {
        toast.error(t("bulk.moveFailed"))
        return
      }
      const done = results.filter((r) => r.ok)
      const failedIds = ids.filter((id) => !done.some((r) => r.id === id))
      const undoable = done.filter((r) => r.previous && r.previous.folderId !== folderId)
      announce({
        okIds: done.map((r) => r.id),
        failedIds,
        success: t(done.length === 1 ? "bulk.moveOne" : "bulk.moveMany", { count: String(done.length) }),
        partial: t("bulk.movePartial", {
          ok: String(done.length),
          total: String(ids.length),
          failed: String(failedIds.length),
        }),
        revert:
          undoable.length === 0
            ? null
            : async () => {
                for (const group of groupBy(undoable, (r) => String(r.previous?.folderId ?? ""))) {
                  await postBatch(
                    { action: "move", folderId: group[0].previous?.folderId ?? null },
                    group.map((r) => r.id)
                  )
                }
              },
      })
    },
    [announce, t]
  )

  const applyTags = useCallback(
    async (ids: string[], add: string[], removeIds: string[]) => {
      let addRes: BatchItemResult[] = []
      let remRes: BatchItemResult[] = []
      try {
        if (add.length > 0) addRes = await postBatch({ action: "tag", tags: add }, ids)
        if (removeIds.length > 0) remRes = await postBatch({ action: "untag", tagIds: removeIds }, ids)
      } catch {
        toast.error(t("bulk.tagsFailed"))
        return
      }
      const refused = new Set([...addRes, ...remRes].filter((r) => !r.ok).map((r) => r.id))
      const failedIds = ids.filter((id) => refused.has(id) || (add.length > 0 && !addRes.some((r) => r.id === id)))
      const okIds = ids.filter((id) => !failedIds.includes(id))

      // Identifiants des tags ajoutés (créés à la volée) : relus par libellé.
      let addedTagIds: string[] = []
      if (add.length > 0 && okIds.length > 0) {
        try {
          const res = await fetch("/api/media/tags")
          const all = ((await res.json()) as { tags?: { id: string; label: string }[] }).tags ?? []
          const wanted = new Set(add.map(normalizeTag))
          addedTagIds = all.filter((x) => wanted.has(normalizeTag(x.label))).map((x) => x.id)
        } catch {
          addedTagIds = []
        }
      }
      const labelOf = new Map<string, string>()
      for (const i of items) for (const tag of i.tags) labelOf.set(tag.id, tag.label)

      const added = okIds
        .map((id) => {
          const before = addRes.find((r) => r.id === id)?.previous?.tagIds ?? []
          return { id, tagIds: addedTagIds.filter((x) => !before.includes(x)) }
        })
        .filter((e) => e.tagIds.length > 0)
      const removed = okIds
        .map((id) => {
          const before = remRes.find((r) => r.id === id)?.previous?.tagIds ?? []
          return { id, tagIds: removeIds.filter((x) => before.includes(x)) }
        })
        .filter((e) => e.tagIds.length > 0)

      announce({
        okIds,
        failedIds,
        success: t("bulk.tagsDone", { count: String(okIds.length) }),
        partial: t("bulk.tagsPartial", {
          ok: String(okIds.length),
          total: String(ids.length),
          failed: String(failedIds.length),
        }),
        revert:
          added.length + removed.length === 0
            ? null
            : async () => {
                for (const g of groupBy(added, (e) => [...e.tagIds].sort().join(","))) {
                  await postBatch({ action: "untag", tagIds: g[0].tagIds }, g.map((e) => e.id))
                }
                for (const g of groupBy(removed, (e) => [...e.tagIds].sort().join(","))) {
                  const labels = g[0].tagIds.map((x) => labelOf.get(x)).filter((x): x is string => Boolean(x))
                  if (labels.length > 0) await postBatch({ action: "tag", tags: labels }, g.map((e) => e.id))
                }
              },
      })
    },
    [announce, items, t]
  )

  /** Restaure de la corbeille : « déjà restauré » compte comme réussi, sans rien à annuler. */
  const restore = useCallback(
    async (ids: string[]) => {
      let results: BatchItemResult[]
      try {
        results = await postBatch({ action: "restore" }, ids)
      } catch {
        toast.error(t("trashView.restoreFailed"))
        return
      }
      const done = results.filter((r) => r.ok)
      const failedIds = ids.filter((id) => !done.some((r) => r.id === id))
      const restored = done.filter((r) => r.error !== "already").map((r) => r.id)
      announce({
        okIds: done.map((r) => r.id),
        failedIds,
        success: t(done.length === 1 ? "trashView.restoredOne" : "trashView.restoredMany", { count: String(done.length) }),
        partial: t("trashView.restoredPartial", {
          ok: String(done.length),
          total: String(ids.length),
          failed: String(failedIds.length),
        }),
        revert:
          restored.length === 0
            ? null
            : async () => {
                // Remet deletedAt à maintenant, par choix : accepter une date du client permettrait de forcer une purge anticipée.
                const back = await postBatch({ action: "trash" }, restored)
                if (back.some((r) => !r.ok)) throw new Error("trash failed")
              },
      })
    },
    [announce, t]
  )

  /** Mise à la corbeille : annonce, empile l'annulation (restauration des seuls mis à la corbeille). */
  const trashed = useCallback(
    (ids: string[], results: BatchItemResult[]) => {
      const done = results.filter((r) => r.ok)
      const failedIds = ids.filter((id) => !done.some((r) => r.id === id))
      const trashedIds = done.filter((r) => r.error !== "already").map((r) => r.id)
      announce({
        okIds: done.map((r) => r.id),
        failedIds,
        success: t(done.length === 1 ? "trash.doneOne" : "trash.doneMany", { count: String(done.length) }),
        partial: t("trash.partial", {
          ok: String(done.length),
          total: String(ids.length),
          failed: String(failedIds.length),
        }),
        revert:
          trashedIds.length === 0
            ? null
            : async () => {
                const back = await postBatch({ action: "restore" }, trashedIds)
                if (back.some((r) => !r.ok)) throw new Error("restore failed")
              },
      })
    },
    [announce, t]
  )

  return { move, applyTags, moveFolder, restore, trashed, settle, undoable, flaggedIds }
}
