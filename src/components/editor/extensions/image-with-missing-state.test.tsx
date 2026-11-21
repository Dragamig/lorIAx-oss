// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"
import { EditorContent } from "@tiptap/react"
import { IMAGE_RETRY_DELAY_MS, ImageWithMissingState } from "./image-with-missing-state"

vi.mock("next-intl", async () => (await import("../../media/test-fixtures")).intlMock())

afterEach(cleanup)

function setup(src: string) {
  const editor = new Editor({
    extensions: [StarterKit, ImageWithMissingState.configure({ allowBase64: true }), Markdown],
    content: { type: "doc", content: [{ type: "image", attrs: { src, alt: "Logo" } }] },
  })
  render(<EditorContent editor={editor} />)
  return editor
}

const md = (e: Editor) => (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()

describe("ImageWithMissingState", () => {
  it.each(["/api/media/0b1c2d3e-0000-4000-8000-000000000000", "https://externe/x.png"])(
    "onError sur %s : cadre accessible, src et Markdown inchangés",
    async (src) => {
      const editor = setup(src)
      const before = md(editor)
      const img = await screen.findByRole("img", { name: "Logo" })
      await act(async () => {
        fireEvent.error(img)
      })
      // Une seule nouvelle tentative avant l'état manquant.
      expect(document.querySelector("[data-media-missing]")).toBeNull()
      await act(async () => {
        await new Promise((r) => setTimeout(r, IMAGE_RETRY_DELAY_MS + 50))
      })
      await act(async () => {
        fireEvent.error(await screen.findByRole("img", { name: "Logo" }))
      })
      const frame = await screen.findByRole("img", { name: /Média manquant/ })
      expect(frame.getAttribute("data-media-missing")).toBe("true")
      expect(frame.getAttribute("aria-label")).toBe("Média manquant : Logo")
      expect(frame.className).toContain("h-[200px]")
      expect(editor.getJSON().content?.[0].attrs?.src).toBe(src)
      expect(md(editor)).toBe(before)
    },
  )

  it("data: qui charge : pas de cadre", async () => {
    setup("data:image/png;base64,AAAA")
    await screen.findByRole("img", { name: "Logo" })
    expect(document.querySelector("[data-media-missing]")).toBeNull()
  })

  it("un échec passager puis un chargement réussi : pas de cadre manquant", async () => {
    setup("/api/media/abc")
    await act(async () => {
      fireEvent.error(await screen.findByRole("img", { name: "Logo" }))
      await new Promise((r) => setTimeout(r, IMAGE_RETRY_DELAY_MS + 50))
    })
    expect(document.querySelector("[data-media-missing]")).toBeNull()
    expect(await screen.findByRole("img", { name: "Logo" })).toBeTruthy()
  })

  it("respecte width et height du nœud", async () => {
    const editor = new Editor({
      extensions: [StarterKit, ImageWithMissingState.configure({ allowBase64: true }), Markdown],
      content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/media/x", alt: "Logo", width: 120, height: 80 } }] },
    })
    render(<EditorContent editor={editor} />)
    const img = await screen.findByRole("img", { name: "Logo" })
    expect(img.getAttribute("width")).toBe("120")
    expect(img.getAttribute("height")).toBe("80")
  })

  it("média à la corbeille (meta deletedAt) : cadre manquant sans erreur de chargement", async () => {
    const id = "0b1c2d3e-0000-4000-8000-0000000000aa"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ media: { deletedAt: "2026-01-01" } }), { status: 200 })),
    )
    setup(`/api/media/${id}`)
    const frame = await screen.findByRole("img", { name: /Média manquant/ })
    expect(frame.getAttribute("data-media-missing")).toBe("true")
    vi.unstubAllGlobals()
  })
})
