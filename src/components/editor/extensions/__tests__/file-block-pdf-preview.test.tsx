// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { EditorContent } from "@tiptap/react"
import { FileBlock } from "../file-block-node"

vi.mock("next-intl", async () => (await import("../../../media/test-fixtures")).intlMock())

const ID = "0b1c2d3e-0000-4000-8000-000000000000"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(mimeType: string, preview = false, editable = true, headStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD"
        ? ({ ok: headStatus >= 200 && headStatus < 300, status: headStatus } as Response)
        : ({
      ok: true,
      status: 200,
      json: async () => ({ media: { id: ID, filename: "rapport.pdf", mimeType, kind: "pdf", sizeBytes: 2048 } }),
    } as Response)),
  )
  const editor = new Editor({
    editable,
    extensions: [StarterKit, FileBlock],
    content: { type: "doc", content: [{ type: "fileBlock", attrs: { mediaId: ID, filename: "rapport.pdf", mimeType, size: 1, preview } }] },
  })
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EditorContent editor={editor} />
    </SWRConfig>,
  )
  return editor
}

describe("aperçu PDF du bloc Fichier", () => {
  it("aucun iframe avant le clic, puis iframe titré, puis retiré par Masquer", async () => {
    const editor = setup("application/pdf")
    const btn = await screen.findByRole("button", { name: "Aperçu" })
    expect(document.querySelector("iframe")).toBeNull()
    fireEvent.click(btn)
    const frame = await waitFor(() => {
      const f = document.querySelector("iframe")
      if (!f) throw new Error("no iframe")
      return f
    })
    expect(frame.getAttribute("src")).toBe(`/api/media/${ID}#view=FitH`)
    expect(frame.getAttribute("title")).toBe("rapport.pdf")
    expect(editor.getJSON().content?.[0].attrs?.preview).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Masquer l'aperçu" }))
    await waitFor(() => expect(document.querySelector("iframe")).toBeNull())
    expect(editor.getJSON().content?.[0].attrs?.preview).toBe(false)
  })

  it("preview ouvert au chargement : l'iframe attend l'entrée dans le viewport", async () => {
    let cb: IntersectionObserverCallback = () => {}
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(c: IntersectionObserverCallback) {
          cb = c
        }
        observe() {}
        disconnect() {}
      },
    )
    setup("application/pdf", true)
    await screen.findByRole("button", { name: "Masquer l'aperçu" })
    expect(document.querySelector("iframe")).toBeNull()
    cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull())
  })

  it("média purgé (HEAD 404) : alerte et aucun iframe", async () => {
    setup("application/pdf", false, true, 404)
    fireEvent.click(await screen.findByRole("button", { name: "Aperçu" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Aperçu indisponible")
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("lecteur : l'ouverture de l'aperçu ne modifie pas le document", async () => {
    const editor = setup("application/pdf", false, false)
    fireEvent.click(await screen.findByRole("button", { name: "Aperçu" }))
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull())
    expect(editor.getJSON().content?.[0].attrs?.preview).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Masquer l'aperçu" }))
    await waitFor(() => expect(document.querySelector("iframe")).toBeNull())
  })

  it("fichier non PDF : pas de bouton Aperçu", async () => {
    setup("image/png")
    await screen.findByText("rapport.pdf")
    expect(screen.queryByRole("button", { name: "Aperçu" })).toBeNull()
  })
})
