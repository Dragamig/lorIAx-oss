"use client"

import useSWR from "swr"

const MEDIA_URL = /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** Identifiant du média pour une URL `/api/media/<uuid>` exactement ; null sinon. */
export function mediaIdFromUrl(url: string | null | undefined): string | null {
  return url?.match(MEDIA_URL)?.[1] ?? null
}

type PresenceMeta = { deletedAt?: string | null }

class PresenceError extends Error {
  constructor(readonly status: number) {
    super(`meta ${status}`)
  }
}

async function fetchPresence(url: string): Promise<PresenceMeta> {
  const res = await fetch(url, { credentials: "same-origin" })
  if (!res.ok) throw new PresenceError(res.status)
  const data = (await res.json()) as { media?: PresenceMeta }
  return data.media ?? {}
}

/**
 * Présence d'un média de la médiathèque. Le serveur sert encore en 200 un média à
 * la corbeille à qui peut écrire : seule la lecture de `/meta` (une requête par id,
 * clé SWR partagée) permet de l'afficher « manquant ». 404, 403 ou `deletedAt`
 * non nul = manquant ; une erreur réseau ne l'est pas.
 */
export function useMediaPresence(mediaId: string | null | undefined): { missing: boolean; loading: boolean } {
  const { data, error, isLoading } = useSWR<PresenceMeta, PresenceError>(
    mediaId ? `/api/media/${mediaId}/meta` : null,
    fetchPresence,
    { dedupingInterval: 2000, revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const status = error?.status
  const missing = !!mediaId && (status === 404 || status === 403 || !!data?.deletedAt)
  return { missing, loading: isLoading }
}
