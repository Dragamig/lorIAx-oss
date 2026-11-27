// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ modules: ["library"] as string[], push: vi.fn(), search: {} as unknown }))

vi.mock("swr", () => ({ default: () => ({ data: { modules: h.modules } }) }))
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push: h.push }) }))
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (k: string) => `${ns}.${k}`,
}))

import { CommandPalette, mediaHref } from "./command-palette"

beforeEach(() => {
  h.modules = ["library"]
  h.push.mockReset()
  h.search = { results: [], media: [{ id: "m1", filename: "logo.png", title: null, spaceName: "Marketing" }] }
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = vi.fn()
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes("/api/search") ? h.search : {}) })
  ) as unknown as typeof fetch
})
afterEach(cleanup)

const open = () => {
  render(<CommandPalette />)
  fireEvent.keyDown(document, { key: "k", ctrlKey: true })
}

describe("palette : médiathèque", () => {
  it("module actif : ouvrir la médiathèque et téléverser, vers les bonnes URL", () => {
    open()
    fireEvent.click(screen.getByText("library.actions.openLibrary"))
    expect(h.push).toHaveBeenCalledWith("/mediatheque")
    cleanup()
    h.push.mockReset()
    open()
    fireEvent.click(screen.getByText("library.actions.upload"))
    expect(h.push).toHaveBeenCalledWith("/mediatheque?upload=1")
  })

  it("module inactif : entrées absentes", () => {
    h.modules = []
    open()
    expect(screen.queryByText("library.actions.openLibrary")).toBeNull()
    expect(screen.queryByText("library.actions.upload")).toBeNull()
  })

  it("résultat média : ouvre la médiathèque sur ce média", async () => {
    open()
    fireEvent.change(screen.getByPlaceholderText("shell.commandPalette.placeholder"), { target: { value: "logo" } })
    const item = await waitFor(() => screen.getByText("logo.png"), { timeout: 2000 })
    fireEvent.click(item)
    expect(h.push).toHaveBeenCalledWith(mediaHref("m1"))
  })

  it("résultat de contenu : groupe dédié, extrait affiché, ouvre la fiche", async () => {
    h.search = {
      results: [],
      media: [],
      mediaContent: [{ id: "m9", filename: "contrat.pdf", title: null, spaceName: "Contrats", snippet: "préavis de trois mois" }],
    }
    open()
    fireEvent.change(screen.getByPlaceholderText("shell.commandPalette.placeholder"), { target: { value: "préavis" } })
    const item = await waitFor(() => screen.getByText("préavis de trois mois"), { timeout: 2000 })
    expect(screen.getByText("library.search.contentGroup")).toBeTruthy()
    fireEvent.click(item)
    expect(h.push).toHaveBeenCalledWith(mediaHref("m9"))
  })
})
