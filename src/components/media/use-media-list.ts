"use client"

import { useCallback } from "react"
import { useSWRConfig } from "swr"
import useSWRInfinite from "swr/infinite"
import { serializeMediaFilters, type MediaFilters } from "@/lib/media/filters"
import type { MediaListItem } from "@/lib/media/list"

type Page = { items: MediaListItem[]; nextCursor: string | null }

async function fetchPage(url: string): Promise<Page> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as Page
}

export type UseMediaList = {
  items: MediaListItem[]
  isLoading: boolean
  isError: boolean
  isValidating: boolean
  loadMore: () => void
  hasMore: boolean
  mutate: () => Promise<void>
}

// Clés SWR d'une liste : "$inf$" + URL de la première page, et une entrée par page (voir swr/infinite).
const isMediaListKey = (key: unknown): boolean =>
  typeof key === "string" && (key.startsWith("$inf$/api/media?") || key.startsWith("/api/media?"))

/**
 * `forced` impose des filtres que l'utilisateur ne peut pas modifier (types
 * acceptés par un sélecteur) : ils l'emportent sur `filters`.
 */
export function useMediaList(filters: MediaFilters, forced?: Partial<MediaFilters>): UseMediaList {
  const base = serializeMediaFilters({ ...filters, ...forced, cursor: undefined }).toString()

  const { mutate: globalMutate, cache } = useSWRConfig()
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<Page>(
    (index, previous) => {
      if (previous && !previous.nextCursor) return null
      const params = new URLSearchParams(base)
      if (index > 0 && previous?.nextCursor) params.set("cursor", previous.nextCursor)
      return `/api/media?${params.toString()}`
    },
    fetchPage,
    {
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      // Pas de fenêtre de déduplication : la purge des listes démontées (refresh) ne vide pas
      // la requête dédupliquée, et une vue rouverte moins de 2 s après une mutation resservait
      // l'ancienne réponse. Deux montages simultanés d'une même clé peuvent donc lancer deux requêtes.
      dedupingInterval: 0,
    }
  )

  const items = data ? data.flatMap((p) => p.items) : []
  const last = data?.[data.length - 1]
  const hasMore = !error && !!last?.nextCursor

  const loadMore = useCallback(() => {
    if (hasMore && !isValidating) void setSize(size + 1)
  }, [hasMore, isValidating, setSize, size])

  // Invalide toutes les listes de médias (toutes vues, tous filtres) : la liste montée
  // est revalidée, les listes déjà consultées mais démontées sont purgées du cache.
  const refresh = useCallback(async () => {
    const keys = [...cache.keys()].filter(isMediaListKey)
    const mounted = `$inf$/api/media?${base}`
    const mountedPage = `/api/media?${base}`
    for (const key of keys) {
      if (key !== mounted && key !== mountedPage) await globalMutate(key, undefined, { revalidate: false })
    }
    await mutate()
  }, [cache, globalMutate, mutate, base])

  return { items, isLoading, isError: !!error, isValidating, loadMore, hasMore, mutate: refresh }
}
