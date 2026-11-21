"use client"

import { useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"
import { MediaPicker } from "@/components/media/picker/media-picker"
import { getEditorId, insertPickedFile, OPEN_FILE_PICKER_EVENT, type OpenImagePickerDetail } from "./media-insert"

export function EditorFilePicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = (e: Event) => {
      // Plusieurs éditeurs peuvent coexister : seul celui désigné ouvre son sélecteur.
      if ((e as CustomEvent<OpenImagePickerDetail>).detail?.editorId === getEditorId(editor)) setOpen(true)
    }
    window.addEventListener(OPEN_FILE_PICKER_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_FILE_PICKER_EVENT, onOpen)
  }, [editor])

  const meta = (editor.storage as unknown as Record<string, unknown>).metaContext as { spaceId?: string } | undefined
  const spaceId = meta?.spaceId || null

  return (
    <MediaPicker
      open={open}
      onOpenChange={setOpen}
      mode="single"
      spaceId={spaceId}
      tabs={["library", "upload"]}
      finalFocus={() => (editor.isDestroyed ? null : (editor.view.dom as HTMLElement))}
      onPick={(items) => insertPickedFile(editor, items)}
    />
  )
}
