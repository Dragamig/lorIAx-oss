"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { usePathname, useRouter } from "@/i18n/routing"
import { parseMediaFilters, serializeMediaFilters, type MediaFilters } from "@/lib/media/filters"

const Q_DEBOUNCE_MS = 250

/** Analyse tolérante : un paramètre invalide retombe sur son défaut sans erreur. */
function parseLenient(params: URLSearchParams): MediaFilters {
  params.delete("cursor")
  const attempt = (p: URLSearchParams): MediaFilters | null => {
    try {
      return parseMediaFilters(p)
    } catch {
      return null
    }
  }
  const full = attempt(params)
  if (full) return full

  const kept = new URLSearchParams()
  for (const key of new Set(params.keys())) {
    const single = new URLSearchParams()
    for (const v of params.getAll(key)) single.append(key, v)
    if (attempt(single)) for (const v of params.getAll(key)) kept.append(key, v)
  }
  // Combinaison contradictoire (période ou taille inversée) : on écarte les paires en cause.
  const combined = attempt(kept)
  if (combined) return combined
  for (const key of ["from", "to", "minSize", "maxSize"]) kept.delete(key)
  return attempt(kept) ?? parseMediaFilters(new URLSearchParams())
}

export type UseLibraryFilters = {
  filters: MediaFilters
  setFilters: (patch: Partial<MediaFilters>) => void
  reset: () => void
  hasActiveFilters: boolean
}

export function useLibraryFilters(): UseLibraryFilters {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = searchParams.toString()

  const filters = useMemo(() => parseLenient(new URLSearchParams(raw)), [raw])

  const latest = useRef(filters)
  useEffect(() => {
    latest.current = filters
  }, [filters])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingQ = useRef<{ q: string | undefined } | null>(null)

  const write = useCallback(
    (next: MediaFilters) => {
      latest.current = next
      const qs = serializeMediaFilters({ ...next, cursor: undefined }).toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    },
    [router, pathname]
  )

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => clearTimer, [])

  const setFilters = useCallback(
    (patch: Partial<MediaFilters>) => {
      const keys = Object.keys(patch)
      if (keys.length === 1 && keys[0] === "q") {
        pendingQ.current = { q: patch.q || undefined }
        clearTimer()
        timer.current = setTimeout(() => {
          const q = pendingQ.current
          pendingQ.current = null
          timer.current = null
          if (q) write({ ...latest.current, q: q.q })
        }, Q_DEBOUNCE_MS)
        return
      }
      const q = pendingQ.current
      pendingQ.current = null
      clearTimer()
      write({ ...latest.current, ...(q ? { q: q.q } : {}), ...patch })
    },
    [write]
  )

  const reset = useCallback(() => {
    pendingQ.current = null
    clearTimer()
    router.replace(pathname)
  }, [router, pathname])

  const hasActiveFilters =
    filters.view !== "all" ||
    !!filters.q ||
    filters.kinds.length > 0 ||
    filters.tagIds.length > 0 ||
    !!filters.spaceId ||
    !!filters.uploadedBy ||
    (filters.ids?.length ?? 0) > 0 ||
    !!filters.from ||
    !!filters.to ||
    filters.minSize !== undefined ||
    filters.maxSize !== undefined

  return { filters, setFilters, reset, hasActiveFilters }
}
