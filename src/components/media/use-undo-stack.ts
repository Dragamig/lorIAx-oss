"use client"

import { useCallback, useRef } from "react"

export type UndoEntry = {
  run: () => Promise<void> | void
  /** Ferme le toast qui proposait « Annuler » quand l'annulation vient du clavier. */
  dismiss?: () => void
  /** Médias (ou dossiers) touchés : sert à refuser un « Annuler » devenu caduc. */
  ids?: string[]
}

export type UndoStack = {
  push: (run: UndoEntry["run"], ids?: string[]) => UndoEntry
  /** Exécute et retire une entrée précise (bouton « Annuler » du toast). */
  run: (entry: UndoEntry) => Promise<void>
  /**
   * « Annuler » d'un toast : n'exécute l'entrée que si aucune entrée plus récente
   * ne touche les mêmes ids. Rend faux (sans rien exécuter) dans le cas contraire.
   */
  tryRun: (entry: UndoEntry) => Promise<boolean>
  /** Ctrl+Z : annule la dernière action encore annulable. Rend faux si la pile est vide. */
  undoLast: () => Promise<boolean>
  /** Retire une entrée sans l'exécuter (action déjà annulée par un autre chemin). */
  drop: (entry: UndoEntry) => void
  /** Vrai s'il reste une action à annuler. */
  canUndo: () => boolean
}

/**
 * Pile locale d'annulations : chaque action de lot y dépose la closure qui
 * rétablit l'état exact d'avant. Vit avec la page : vidée au démontage.
 */
export function useUndoStack(): UndoStack {
  const stack = useRef<UndoEntry[]>([])

  const drop = useCallback((entry: UndoEntry) => {
    stack.current = stack.current.filter((e) => e !== entry)
  }, [])
  const push = useCallback((run: UndoEntry["run"], ids?: string[]) => {
    const entry: UndoEntry = { run, ids }
    stack.current.push(entry)
    return entry
  }, [])
  const run = useCallback(
    async (entry: UndoEntry) => {
      drop(entry)
      await entry.run()
    },
    [drop]
  )
  const tryRun = useCallback(
    async (entry: UndoEntry) => {
      const at = stack.current.indexOf(entry)
      const mine = new Set(entry.ids ?? [])
      const stale =
        mine.size > 0 && at >= 0 && stack.current.slice(at + 1).some((e) => (e.ids ?? []).some((id) => mine.has(id)))
      if (stale) return false
      await run(entry)
      return true
    },
    [run]
  )
  const undoLast = useCallback(async () => {
    const entry = stack.current.at(-1)
    if (!entry) return false
    entry.dismiss?.()
    await run(entry)
    return true
  }, [run])

  const canUndo = useCallback(() => stack.current.length > 0, [])

  return { push, run, tryRun, undoLast, drop, canUndo }
}
