// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import type { Editor } from "@tiptap/react"
import type { PickedMedia } from "@/components/media/picker/types"
import { insertPickedImages } from "./media-insert"

function media(id: string, altText: string | null): PickedMedia {
  return { id, url: `/api/media/${id}`, filename: `${id}.png`, title: null, altText, mimeType: "image/png", kind: "image", sizeBytes: 1 }
}

function fakeEditor(ok = true) {
  const insertContent = vi.fn(() => ({ run: () => ok }))
  const editor = { isDestroyed: false, chain: () => ({ focus: () => ({ insertContent }) }) } as unknown as Editor
  return { editor, insertContent }
}

describe("insertPickedImages", () => {
  it("reprend l'alt du média par défaut", () => {
    const { editor, insertContent } = fakeEditor()
    insertPickedImages(editor, [media("a", "Logo")])
    expect(insertContent).toHaveBeenCalledWith([{ type: "image", attrs: { src: "/api/media/a", alt: "Logo" } }])
  })
  it("l'alt saisi prime", () => {
    const { editor, insertContent } = fakeEditor()
    insertPickedImages(editor, [media("a", "Logo")], { alt: "Autre" })
    expect(insertContent).toHaveBeenCalledWith([{ type: "image", attrs: { src: "/api/media/a", alt: "Autre" } }])
  })
  it("insère plusieurs nœuds dans l'ordre", () => {
    const { editor, insertContent } = fakeEditor()
    insertPickedImages(editor, [media("a", null), media("b", null), media("c", null)])
    const nodes = (insertContent.mock.calls[0] as unknown as [{ attrs: { src: string; alt: string } }[]])[0]
    expect(nodes.map((n) => n.attrs.src)).toEqual(["/api/media/a", "/api/media/b", "/api/media/c"])
    expect(nodes[0].attrs.alt).toBe("")
  })
  it("échec d'insertion : lève, sans FileReader", () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsDataURL")
    const { editor } = fakeEditor(false)
    expect(() => insertPickedImages(editor, [media("a", null)])).toThrow()
    expect(spy).not.toHaveBeenCalled()
  })
})
