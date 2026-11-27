type VersionedMedia = { id: string; currentVersion: number }

/** Vignette d'un média ; `?v=` force le rafraîchissement dès qu'une nouvelle version devient courante. */
export function mediaThumbnailUrl(m: VersionedMedia): string {
  return `/api/media/${m.id}/thumbnail?v=${m.currentVersion}`
}

/** Contenu de la version courante, avec la même clé de rafraîchissement. */
export function mediaContentUrl(m: VersionedMedia): string {
  return `/api/media/${m.id}?v=${m.currentVersion}`
}

/** Contenu d'une version précise de l'historique. */
export function mediaVersionContentUrl(mediaId: string, version: number): string {
  return `/api/media/${mediaId}/versions/${version}/content`
}
