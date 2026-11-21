import type { Editor } from "@tiptap/react"
import type { PickedMedia } from "@/components/media/picker/types"

export const OPEN_IMAGE_PICKER_EVENT = "loriax:open-image-picker"

const editorIds = new WeakMap<Editor, string>()
let editorSeq = 0

/** Identifiant stable d'un éditeur, porté par l'événement d'ouverture du sélecteur. */
export function getEditorId(editor: Editor): string {
  let id = editorIds.get(editor)
  if (!id) {
    id = `editor-${++editorSeq}`
    editorIds.set(editor, id)
  }
  return id
}

export type OpenImagePickerDetail = { editorId: string }

/** Demande l'ouverture du sélecteur d'images ; seul l'éditeur désigné la traite. */
export function requestImagePicker(editor: Editor): void {
  window.dispatchEvent(
    new CustomEvent<OpenImagePickerDetail>(OPEN_IMAGE_PICKER_EVENT, { detail: { editorId: getEditorId(editor) } })
  )
}

/**
 * Insère les médias choisis comme images `/api/media/<id>`. L'alt de l'occurrence
 * vient de `opts.alt`, sinon du texte alternatif du média ; le média n'est jamais modifié.
 */
export function insertPickedImages(editor: Editor, picked: PickedMedia[], opts: { alt?: string } = {}): void {
  if (picked.length === 0) return
  if (editor.isDestroyed) throw new Error("editor destroyed")
  const nodes = picked.map((m) => ({
    type: "image",
    attrs: { src: `/api/media/${m.id}`, alt: opts.alt ?? m.altText ?? "" },
  }))
  const ok = editor.chain().focus().insertContent(nodes).run()
  if (!ok) throw new Error("insert failed")
}

export const OPEN_FILE_PICKER_EVENT = "loriax:open-file-picker"

/** Demande l'ouverture du sélecteur de fichiers ; seul l'éditeur désigné la traite. */
export function requestFilePicker(editor: Editor): void {
  window.dispatchEvent(
    new CustomEvent<OpenImagePickerDetail>(OPEN_FILE_PICKER_EVENT, { detail: { editorId: getEditorId(editor) } })
  )
}

/** Insère le média choisi comme bloc Fichier (le média fait foi, les attributs sont des copies d'affichage). */
export function insertPickedFile(editor: Editor, picked: PickedMedia[]): void {
  const m = picked[0]
  if (!m) return
  if (editor.isDestroyed) throw new Error("editor destroyed")
  const ok = editor
    .chain()
    .focus()
    .setFileBlock({ mediaId: m.id, filename: m.filename, mimeType: m.mimeType, size: m.sizeBytes })
    .run()
  if (!ok) throw new Error("insert failed")
}
