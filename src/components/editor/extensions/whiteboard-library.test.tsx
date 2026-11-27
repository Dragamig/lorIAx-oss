// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  toastOk: vi.fn(),
  toastErr: vi.fn(),
  pick: null as null | ((items: unknown[]) => void | Promise<void>),
}))
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
}))
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: h.toastErr } }))
vi.mock("@/components/media/picker/media-picker", () => ({
  MediaPicker: (p: { open: boolean; onPick: (items: unknown[]) => void }) => {
    h.pick = p.onPick
    return p.open ? <div data-testid="picker" /> : null
  },
}))

import { insertLibraryImages, WhiteboardLibraryButton, type WhiteboardApi } from "./whiteboard-library"

const item = (id: string, name = `${id}.png`) => ({
  id,
  url: `/api/media/${id}`,
  filename: name,
  title: null,
  altText: null,
  mimeType: "image/png",
  kind: "image" as const,
  sizeBytes: 3,
})
const measure = async () => ({ width: 800, height: 400 })

function makeApi() {
  return {
    addFiles: vi.fn(),
    updateScene: vi.fn(),
    getSceneElements: () => [{ id: "existing" }],
    getAppState: () => ({ scrollX: 0, scrollY: 0, width: 1000, height: 600, zoom: { value: 1 } }),
  } satisfies WhiteboardApi
}

const fetchMock = vi.fn()
beforeEach(() => {
  h.toastOk.mockReset()
  h.toastErr.mockReset()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, blob: async () => new Blob(["abc"], { type: "image/png" }) }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("insertLibraryImages", () => {
  it("ajoute un fichier et un élément image par média", async () => {
    const api = makeApi()
    const res = await insertLibraryImages(api, [item("a"), item("b")], { measure })
    expect(res).toEqual({ inserted: 2, failed: [] })
    const files = api.addFiles.mock.calls[0][0] as { id: string; dataURL: string }[]
    expect(files).toHaveLength(2)
    expect(files[0].dataURL.startsWith("data:")).toBe(true)
    const els = api.updateScene.mock.calls[0][0].elements as { type: string; fileId: string; width: number }[]
    expect(els).toHaveLength(3)
    expect(els[1]).toMatchObject({ type: "image", fileId: files[0].id, width: 400 })
  })

  it("customData.mediaId porte l'identifiant", async () => {
    const api = makeApi()
    await insertLibraryImages(api, [item("media-1")], { measure })
    const els = api.updateScene.mock.calls[0][0].elements as { customData?: { mediaId: string } }[]
    expect(els[1].customData).toEqual({ mediaId: "media-1" })
  })

  it("un échec de téléchargement est listé sans bloquer les autres", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500 }))
    const api = makeApi()
    const res = await insertLibraryImages(api, [item("bad", "bad.png"), item("good")], { measure })
    expect(res).toEqual({ inserted: 1, failed: ["bad.png"] })
  })

  it("n'appelle pas l'API de scène sans image insérée", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404 }))
    const api = makeApi()
    await insertLibraryImages(api, [item("x")], { measure })
    expect(api.updateScene).not.toHaveBeenCalled()
  })
})

describe("WhiteboardLibraryButton", () => {
  it("le bouton a icône, aria-label et info-bulle", () => {
    const { container } = render(<WhiteboardLibraryButton getApi={() => null} spaceId={null} />)
    const btn = screen.getByRole("button", { name: "insertImage" })
    expect(btn.querySelector("svg")).not.toBeNull()
    fireEvent.focus(btn.parentElement as HTMLElement)
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe("insertImage")
  })

  it("le picker s'ouvre au clic", () => {
    render(<WhiteboardLibraryButton getApi={() => null} spaceId={null} />)
    expect(screen.queryByTestId("picker")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "insertImage" }))
    expect(screen.getByTestId("picker")).toBeTruthy()
  })

  it("toast de succès avec le nombre inséré", async () => {
    const api = makeApi()
    render(<WhiteboardLibraryButton getApi={() => api} spaceId="s" />)
    await h.pick?.([item("a")])
    await waitFor(() => expect(h.toastOk).toHaveBeenCalledWith('inserted:{"count":1}'))
  })

  it("toast d'erreur quand l'éditeur n'est pas prêt", async () => {
    render(<WhiteboardLibraryButton getApi={() => null} spaceId={null} />)
    await h.pick?.([item("a")])
    expect(h.toastErr).toHaveBeenCalledWith("insertDisabled")
  })
})
