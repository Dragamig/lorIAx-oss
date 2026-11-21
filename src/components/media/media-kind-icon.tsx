import { Archive, File, FileText, Film, Image as ImageIcon, Music, Sheet, type LucideIcon } from "lucide-react"
import type { MediaKind } from "@/lib/db/schema"

export const KIND_ICONS: Record<MediaKind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
  document: Sheet,
  video: Film,
  audio: Music,
  archive: Archive,
  other: File,
}
