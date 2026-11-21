// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import { EditorImagePicker } from "../editor-image-picker"
import { requestImagePicker } from "../media-insert"

const h = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock("@/components/media/picker/media-picker", () => ({
  MediaPicker: (p: Record<string, unknown>) => {
    h.props = p
    return null
  },
}))

afterEach(cleanup)

describe("EditorImagePicker", () => {
  it("s'ouvre sur l'événement avec la configuration image", () => {
    const editor = new Editor({ extensions: [StarterKit, Image] })
    render(<EditorImagePicker editor={editor as never} />)
    expect(h.props?.open).toBe(false)
    act(() => requestImagePicker(editor as never))
    expect(h.props).toMatchObject({
      open: true,
      accept: ["image"],
      mode: "single",
      tabs: ["library", "upload", "url", "bank"],
      showAlt: true,
    })
  })

  it("ignore l'événement d'un autre éditeur, transmet l'espace du document et le focus final", () => {
    const editor = new Editor({ extensions: [StarterKit, Image] })
    const other = new Editor({ extensions: [StarterKit, Image] })
    ;(editor.storage as unknown as Record<string, unknown>).metaContext = { spaceId: "sp1", docId: "d1" }
    render(<EditorImagePicker editor={editor as never} />)
    act(() => requestImagePicker(other as never))
    expect(h.props?.open).toBe(false)
    act(() => requestImagePicker(editor as never))
    expect(h.props?.open).toBe(true)
    expect(h.props?.spaceId).toBe("sp1")
    expect((h.props?.finalFocus as () => unknown)()).toBe(editor.view.dom)
  })

  it("un document avec image data: reste intact", () => {
    const src = "data:image/png;base64,AAAA"
    const editor = new Editor({
      extensions: [StarterKit, Image],
      content: { type: "doc", content: [{ type: "image", attrs: { src, alt: "x" } }] },
    })
    expect(editor.getJSON().content?.[0].attrs?.src).toBe(src)
  })
})
