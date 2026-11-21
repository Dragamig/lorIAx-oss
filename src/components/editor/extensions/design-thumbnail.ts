const MEDIA_URL = /^\/api\/media\/[0-9a-f-]{36}$/i

/**
 * URL affichable d'une miniature de bloc design : `data:`, `http` et
 * `/api/media/<uuid>` inchangés, ancienne clé relative préfixée de
 * `/api/attachments/`.
 */
export function resolveThumbnailSrc(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.startsWith("data:") || value.startsWith("http") || MEDIA_URL.test(value)) return value
  return `/api/attachments/${value}`
}

let lastUploaded: { data: string; url: string } | null = null

/**
 * Enregistre une miniature `data:` comme média d'origine `studio` et rend
 * `/api/media/<uuid>`. Rend `null` en cas d'échec (l'appelant garde alors la
 * valeur `data:`). Une miniature identique à la précédente n'est pas renvoyée.
 */
export async function uploadDesignThumbnail(dataUrl: string, spaceId?: string | null): Promise<string | null> {
  if (!dataUrl.startsWith("data:image/")) return null
  if (lastUploaded?.data === dataUrl) return lastUploaded.url
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const ext = blob.type === "image/png" ? "png" : "jpg"
    const fd = new FormData()
    fd.append("file", new File([blob], `miniature-design.${ext}`, { type: blob.type }))
    fd.append("name", "Miniature de design")
    fd.append("kind", "design-thumbnail")
    if (spaceId) fd.append("spaceId", spaceId)
    const res = await fetch("/api/studio/images", { method: "POST", body: fd })
    if (!res.ok) return null
    const body = (await res.json()) as { id?: string }
    if (!body.id) return null
    const url = `/api/media/${body.id}`
    lastUploaded = { data: dataUrl, url }
    return url
  } catch {
    return null
  }
}
