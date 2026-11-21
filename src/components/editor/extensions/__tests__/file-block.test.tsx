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
const LONG = "x".repeat(500) + ".pdf"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mockMeta(res: { status: number; body?: unknown } | "network") {
  const fn = vi.fn(async () => {
    if (res === "network") throw new Error("offline")
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body ?? {},
    } as Response
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function setup(attrs: Record<string, unknown> = {}, editable = true) {
  const editor = new Editor({
    editable,
    extensions: [StarterKit, FileBlock],
    content: {
      type: "doc",
      content: [
        {
          type: "fileBlock",
          attrs: { mediaId: ID, filename: "attr.pdf", mimeType: "application/pdf", size: 1, preview: false, ...attrs },
        },
      ],
    },
  })
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EditorContent editor={editor} />
    </SWRConfig>,
  )
  return editor
}

const ok = (over: Record<string, unknown> = {}) => ({
  status: 200,
  body: { media: { id: ID, filename: "rapport.pdf", mimeType: "application/pdf", kind: "pdf", sizeBytes: 2048, ...over } },
})

describe("vue du bloc Fichier", () => {
  it("traite un média à la corbeille (deletedAt renseigné) comme manquant", async () => {
    mockMeta(ok({ deletedAt: "2026-11-15T10:00:00.000Z" }))
    setup()
    await waitFor(() => expect(document.querySelector('[data-media-missing="true"]')).toBeTruthy())
    expect(screen.queryByText("rapport.pdf")).toBeNull()
    expect(screen.queryByRole("link", { name: "Télécharger" })).toBeNull()
  })

  it("affiche nom, type et taille issus de meta plutôt que des attributs", async () => {
    mockMeta(ok())
    setup()
    expect(await screen.findByText("rapport.pdf")).toBeTruthy()
    expect(screen.queryByText("attr.pdf")).toBeNull()
    expect(screen.getByText(/PDF · 2/)).toBeTruthy()
    const dl = screen.getByRole("link", { name: "Télécharger" })
    expect(dl.getAttribute("href")).toBe(`/api/media/${ID}?download=1`)
    expect(dl.hasAttribute("download")).toBe(true)
  })

  it("meta 404 : Média manquant, nom des attributs non affiché, téléchargement désactivé", async () => {
    mockMeta({ status: 404 })
    setup()
    const frame = await screen.findByRole("group", { name: /Média manquant/ })
    expect(frame.getAttribute("data-media-missing")).toBe("true")
    expect(screen.queryByText("attr.pdf")).toBeNull()
    expect(document.body.textContent).not.toContain("attr.pdf")
    const dl = screen.getByRole("button", { name: /Télécharger/ }) as HTMLButtonElement
    expect(dl.disabled).toBe(true)
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Fichier introuvable")
  })

  it("média manquant : la raison est atteignable au clavier et dans le nom accessible", async () => {
    mockMeta({ status: 404 })
    setup()
    const btn = (await screen.findByRole("button", { name: /Télécharger.*Fichier introuvable/ })) as HTMLButtonElement
    const wrap = btn.parentElement as HTMLElement
    expect(wrap.tabIndex).toBe(0)
    fireEvent.focus(wrap)
    expect((await screen.findByRole("tooltip")).textContent).toBe("Fichier introuvable")
  })

  it("chargement : squelette de même hauteur", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
    setup()
    const sk = document.querySelector("[data-file-block-state='loading']") as HTMLElement
    expect(sk.className).toContain("h-[72px]")
  })

  it("erreur réseau : Réessayer relance la lecture", async () => {
    const fn = mockMeta("network")
    setup()
    const retry = await screen.findByRole("button", { name: "Réessayer" })
    fn.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ok().body }) as Response)
    fireEvent.click(retry)
    expect(await screen.findByText("rapport.pdf")).toBeTruthy()
  })

  it("hauteur constante et nom tronqué avec info-bulle du nom complet", async () => {
    mockMeta(ok({ filename: LONG }))
    setup()
    const name = await screen.findByText(LONG)
    expect(name.className).toContain("truncate")
    expect(name.getAttribute("title")).toBe(LONG)
    expect((document.querySelector("[data-file-block-state='ready']") as HTMLElement).className).toContain("h-[72px]")
  })

  it("le bouton Télécharger a une icône, un aria-label et une info-bulle", async () => {
    mockMeta(ok())
    setup()
    const dl = await screen.findByRole("link", { name: "Télécharger" })
    expect(dl.querySelector("svg")).not.toBeNull()
    fireEvent.focus(dl.parentElement as HTMLElement)
    expect((await screen.findByRole("tooltip")).textContent).toBe("Télécharger")
  })

  it("lecture seule : aucun bouton de retrait", async () => {
    mockMeta(ok())
    setup({}, false)
    await screen.findByText("rapport.pdf")
    expect(screen.queryByRole("button", { name: /Retirer|Supprimer/ })).toBeNull()
  })

  it("aucun appel réseau n'est fait sans identifiant", async () => {
    const fn = mockMeta(ok())
    setup({ mediaId: null })
    await waitFor(() => expect(fn).not.toHaveBeenCalled())
  })
})
