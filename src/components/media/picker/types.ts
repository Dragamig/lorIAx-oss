import type { MediaKind } from "@/lib/db/schema"
import type { UploadQueueOptions } from "../upload-queue"

export type PickedMedia = {
  id: string
  url: string
  filename: string
  title: string | null
  altText: string | null
  mimeType: string
  kind: MediaKind
  sizeBytes: number
}

export type MediaPickerTab = "library" | "upload" | "url" | "bank"

export type MediaPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (items: PickedMedia[], opts: { alt?: string }) => void | Promise<void>
  accept?: MediaKind[]
  mode?: "single" | "multiple"
  max?: number
  spaceId?: string | null
  tabs?: MediaPickerTab[]
  showAlt?: boolean
  title?: string
  /** Élément qui reçoit le focus à la fermeture (l'éditeur, par exemple) ; sinon le déclencheur. */
  finalFocus?: () => HTMLElement | null
  /** Réglages de la file d'envoi (tests). */
  uploadOptions?: UploadQueueOptions
}
