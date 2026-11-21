import type { MediaListItem } from "@/lib/media/list"

export type ImportBody = {
  url: string
  origin: "upload" | "stock"
  spaceId?: string | null
  displayName?: string
}

/**
 * Appelle `POST /api/media/import`. Le serveur renvoie un code d'erreur stable ;
 * `translateError` (ex. `useTranslations("library.picker.errors")`) en fait le
 * message affiché. Sans traducteur ou pour un code inconnu : `fallbackError`.
 */
export async function importRemote(
  body: ImportBody,
  fallbackError: string,
  translateError?: (code: string) => string | null,
  signal?: AbortSignal,
): Promise<MediaListItem> {
  let res: Response
  try {
    res = await fetch("/api/media/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new Error(fallbackError)
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    const code = data?.error
    const message = code && translateError ? translateError(code) : null
    throw new Error(message || fallbackError)
  }
  const data = (await res.json()) as { media: MediaListItem }
  return data.media
}
