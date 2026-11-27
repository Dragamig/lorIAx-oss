"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { MediaTextState } from "@/lib/media/ai/text-state"

export type MediaTextView = {
  status: MediaTextState["status"]
  reason: string | null
  source: MediaTextState["source"]
  /** Texte complet (toutes les pages réunies). */
  text: string | null
  truncated: boolean
  indexedAt: string | null
  totalChars: number
}

export type MediaTextHook =
  | { phase: "loading" }
  | { phase: "error"; retry: () => void }
  | { phase: "ready"; data: MediaTextView; refresh: () => void }

const POLL_MS = 5000
const MAX_PAGES = 12

async function fetchState(mediaId: string, withText: boolean): Promise<MediaTextView> {
  let offset = 0
  let text = ""
  let first: MediaTextState | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = !withText ? "?limit=1" : offset > 0 ? `?offset=${offset}` : ""
    const res = await fetch(`/api/media/${mediaId}/text${qs}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const page = (await res.json()) as MediaTextState
    first ??= page
    if (page.text) text += page.text
    if (!withText || page.nextOffset == null) break
    offset = page.nextOffset
  }
  const s = first!
  return {
    status: s.status,
    reason: s.reason,
    source: s.source,
    text: s.status === "done" && withText ? text : null,
    truncated: s.truncated,
    indexedAt: s.indexedAt,
    totalChars: s.totalChars,
  }
}

/**
 * État d'indexation d'un média. `withText` lit aussi le texte complet (pages réunies).
 * `poll` : relit toutes les 5 s tant que l'état est `pending` ou `running`, onglet visible seulement.
 */
export function useMediaText(mediaId: string, opts: { withText?: boolean; poll?: boolean } = {}): MediaTextHook {
  const { withText = false, poll = false } = opts
  const [state, setState] = useState<MediaTextHook>({ phase: "loading" })
  const current = useRef(mediaId)
  const seq = useRef(0)

  const load = useCallback(
    async (silent: boolean) => {
      const mine = ++seq.current
      if (!silent) setState({ phase: "loading" })
      try {
        const data = await fetchState(mediaId, withText)
        if (mine !== seq.current || current.current !== mediaId) return
        setState({ phase: "ready", data, refresh: () => void load(true) })
      } catch {
        if (mine !== seq.current || current.current !== mediaId) return
        if (!silent) setState({ phase: "error", retry: () => void load(false) })
      }
    },
    [mediaId, withText],
  )

  useEffect(() => {
    current.current = mediaId
    const counter = seq
    void load(false)
    return () => {
      counter.current++
    }
  }, [mediaId, load])

  const active = state.phase === "ready" && (state.data.status === "pending" || state.data.status === "running")
  useEffect(() => {
    if (!poll || !active) return
    const tick = () => {
      if (document.visibilityState === "visible") void load(true)
    }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [poll, active, load])

  return state
}
