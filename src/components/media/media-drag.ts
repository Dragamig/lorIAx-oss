import type { DragEvent } from "react"

/** Type MIME des glissements internes (médias et dossiers de la médiathèque). */
export const MEDIA_DRAG_MIME = "application/x-loriax-media"
export const FOLDER_DRAG_MIME = "application/x-loriax-folder"

/** Glisser-déposer de médias : la page tient les ids, les vues les déclenchent. */
export type MediaDrag = {
  /** Ids à glisser pour une tuile : la sélection entière si la tuile en fait partie. */
  idsFor: (id: string) => string[]
  onStart: (ids: string[]) => void
  onEnd: () => void
}

export function startMediaDrag(e: DragEvent, id: string, drag: MediaDrag | undefined) {
  if (!drag) return
  const ids = drag.idsFor(id)
  drag.onStart(ids)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move"
    // Firefox exige une donnée pour démarrer un glissement.
    e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(ids))
  }
}
