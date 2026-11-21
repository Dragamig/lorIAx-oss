"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react"
import type { MediaListItem } from "@/lib/media/list"
import type { Selection } from "./use-selection"

type Options = {
  items: MediaListItem[]
  /** Nombre de colonnes (1 pour la liste). */
  columns: number
  selection: Selection
  onOpen: (item: MediaListItem) => void
  scrollToIndex: (index: number) => void
  containerRef: RefObject<HTMLElement | null>
}

/**
 * Focus itinérant (une seule tabulation) partagé par la grille et la liste :
 * flèches, Début, Fin, Entrée ouvre, Espace coche, Ctrl+A tout, Échap désélectionne.
 * Le focus est rendu à l'élément équivalent après chaque mise à jour.
 */
export function useMediaNav({ items, columns, selection, onOpen, scrollToIndex, containerRef }: Options) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const hasFocus = useRef(false)

  const effectiveId = focusedId && items.some((i) => i.id === focusedId) ? focusedId : (items[0]?.id ?? null)

  useEffect(() => {
    if (!hasFocus.current || !effectiveId) return
    const nodes = containerRef.current?.querySelectorAll<HTMLElement>("[data-media-id]") ?? []
    const el = Array.from(nodes).find((n) => n.dataset.mediaId === effectiveId)
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
  })

  const moveTo = useCallback(
    (index: number) => {
      const target = items[Math.max(0, Math.min(items.length - 1, index))]
      if (!target) return
      hasFocus.current = true
      setFocusedId(target.id)
      scrollToIndex(Math.max(0, Math.min(items.length - 1, index)))
    },
    [items, scrollToIndex]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const fromEl = (e.target as HTMLElement).closest<HTMLElement>("[data-media-id]")
    const id = fromEl?.dataset.mediaId ?? effectiveId
    const index = items.findIndex((i) => i.id === id)
    if (index < 0) return
    const step: Record<string, number> = {
      ArrowRight: columns > 1 ? 1 : 0,
      ArrowLeft: columns > 1 ? -1 : 0,
      ArrowDown: columns,
      ArrowUp: -columns,
    }
    if (e.key in step) {
      if (step[e.key] === 0) return
      e.preventDefault()
      moveTo(index + step[e.key])
    } else if (e.key === "Home") {
      e.preventDefault()
      moveTo(0)
    } else if (e.key === "End") {
      e.preventDefault()
      moveTo(items.length - 1)
    } else if (e.key === "Enter") {
      e.preventDefault()
      onOpen(items[index])
    } else if (e.key === " ") {
      e.preventDefault()
      if (e.shiftKey) selection.range(items[index].id)
      else selection.toggle(items[index].id)
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault()
      selection.all()
    } else if (e.key === "Escape") {
      selection.clear()
    }
  }

  return {
    focusedId: effectiveId,
    setFocusedId,
    containerProps: {
      onKeyDown,
      onFocus: () => {
        hasFocus.current = true
      },
      onBlur: (e: React.FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hasFocus.current = false
      },
    },
  }
}
