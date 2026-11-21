"use client"

import { useCallback, useState } from "react"
import type { PickedMedia } from "./types"

export type PickerSelection = {
  selected: PickedMedia[]
  toggle: (m: PickedMedia) => void
  clear: () => void
  /** Retire de la sélection les médias donnés (téléversement annulé, corbeille). */
  removeMany: (ids: string[]) => void
  isSelected: (id: string) => boolean
  atMax: boolean
}

/**
 * Sélection du sélecteur de médias. En mode simple, un nouveau choix remplace
 * le précédent ; en mode multiple, le plafond `max` bloque les ajouts.
 */
export function usePickerSelection(mode: "single" | "multiple", max?: number): PickerSelection {
  const [selected, setSelected] = useState<PickedMedia[]>([])
  const cap = mode === "single" ? 1 : max ?? Infinity

  const toggle = useCallback(
    (m: PickedMedia) =>
      setSelected((cur) => {
        if (cur.some((x) => x.id === m.id)) return cur.filter((x) => x.id !== m.id)
        if (mode === "single") return [m]
        if (cur.length >= cap) return cur
        return [...cur, m]
      }),
    [mode, cap],
  )
  const clear = useCallback(() => setSelected([]), [])
  const removeMany = useCallback((ids: string[]) => setSelected((cur) => cur.filter((x) => !ids.includes(x.id))), [])
  const isSelected = useCallback((id: string) => selected.some((x) => x.id === id), [selected])

  return { selected, toggle, clear, removeMany, isSelected, atMax: mode === "multiple" && selected.length >= cap }
}
