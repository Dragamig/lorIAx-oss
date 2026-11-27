/** Version telle que l'API la renvoie (sans clé de stockage). */
export type MediaVersionDto = {
  id: string
  mediaId: string
  version: number
  filename: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  pageCount: number | null
  createdBy: string | null
  /** Nom de l'auteur, joint côté serveur (null si inconnu ou hors organisation). */
  createdByName: string | null
  createdAt: string
  comment: string | null
  restoredFrom: number | null
  hasThumbnail: boolean
}

/** Rétention : nombre maximal de versions conservées par média (miroir de `MEDIA_VERSIONS_MAX`). */
export const VERSIONS_LIMIT = 20
