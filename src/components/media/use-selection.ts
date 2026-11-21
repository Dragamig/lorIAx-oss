"use client"

import { useCallback, useMemo, useState } from "react"

export type Selection = {
  selected: Set<string>
  anchorId: string | null
  toggle: (id: string) => void
  range: (toId: string) => void
  all: () => void
  clear: () => void
  /** Ne garde que ces ids (ceux d'un lot partiellement refusé). */
  keepOnly: (ids: string[]) => void
  isSelected: (id: string) => boolean
}

/**
 * Sélection multiple sur une liste ordonnée d'ids. Les ids qui quittent la
 * liste sortent de la sélection ; ceux qui s'ajoutent (chargement de la suite)
 * ne la modifient pas.
 */
export function useSelection(orderedIds: string[]): Selection {
  const [state, setState] = useState<{ ids: string[]; anchor: string | null }>({ ids: [], anchor: null })
  const present = useMemo(() => new Set(orderedIds), [orderedIds])

  // Ids absents de la liste : purgés de l'état (et non seulement masqués), sinon
  // ils réapparaîtraient au retour sur la vue ou le filtre d'origine.
  if (state.ids.some((id) => !present.has(id)) || (state.anchor && !present.has(state.anchor))) {
    setState({
      ids: state.ids.filter((id) => present.has(id)),
      anchor: state.anchor && present.has(state.anchor) ? state.anchor : null,
    })
  }

  const selected = useMemo(() => new Set(state.ids.filter((id) => present.has(id))), [state.ids, present])
  const anchorId = state.anchor && present.has(state.anchor) ? state.anchor : null

  const toggle = useCallback(
    (id: string) =>
      setState((s) => {
        const set = new Set(s.ids.filter((x) => present.has(x)))
        if (set.has(id)) set.delete(id)
        else set.add(id)
        return { ids: [...set], anchor: id }
      }),
    [present]
  )

  const range = useCallback(
    (toId: string) =>
      setState((s) => {
        const to = orderedIds.indexOf(toId)
        if (to < 0) return s
        const from = s.anchor ? orderedIds.indexOf(s.anchor) : -1
        const start = from < 0 ? to : Math.min(from, to)
        const end = from < 0 ? to : Math.max(from, to)
        const set = new Set(s.ids.filter((x) => present.has(x)))
        for (let i = start; i <= end; i++) set.add(orderedIds[i])
        return { ids: [...set], anchor: from < 0 ? toId : s.anchor }
      }),
    [orderedIds, present]
  )

  const all = useCallback(() => setState((s) => ({ ids: [...orderedIds], anchor: s.anchor })), [orderedIds])
  const clear = useCallback(() => setState({ ids: [], anchor: null }), [])
  const keepOnly = useCallback(
    (ids: string[]) => setState((s) => ({ ids: [...ids], anchor: ids.includes(s.anchor ?? "") ? s.anchor : null })),
    []
  )
  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  return { selected, anchorId, toggle, range, all, clear, keepOnly, isSelected }
}
