// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { SWRConfig } from "swr"
import { makeItems, mockLayout } from "../test-fixtures"
import type { SendFn } from "../upload-queue"
import { MediaPicker } from "./media-picker"
import type { MediaPickerProps } from "./types"

const h = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }))

vi.mock("next-intl", async () => (await import("../test-fixtures")).intlMock())
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, info: vi.fn() } }))

const fetchMock = vi.fn()
let listResponse: () => Promise<unknown>

beforeEach(() => {
  mockLayout()
  h.toastError.mockReset()
  h.toastSuccess.mockReset()
  fetchMock.mockReset()
  listResponse = async () => ({ ok: true, json: async () => ({ items: makeItems(3), nextCursor: null }) })
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/media/stats")) return Promise.resolve({ ok: true, json: async () => ({ byTag: [] }) })
    if (url.startsWith("/api/media/folders")) return Promise.resolve({ ok: true, json: async () => ({ folders: [] }) })
    if (url.startsWith("/api/spaces")) return Promise.resolve({ ok: true, json: async () => [] })
    if (url.endsWith("/meta")) return Promise.resolve({ ok: true, json: async () => ({ media: makeItems(1)[0] }) })
    if (url.startsWith("/api/media/batch")) return Promise.resolve({ ok: true, json: async () => ({}) })
    return listResponse()
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(props: Partial<MediaPickerProps> = {}) {
  const onPick = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MediaPicker open onOpenChange={onOpenChange} onPick={onPick} accept={["image"]} {...props} />
    </SWRConfig>
  )
  return { onPick, onOpenChange }
}

const listCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/media?"))
const tile = (name: string) => screen.getByRole("option", { name: new RegExp(name) })
const insertBtn = () => screen.getByRole("button", { name: "Insérer" }) as HTMLButtonElement

describe("MediaPicker, onglet Médiathèque", () => {
  it("impose kind=image dans la requête et masque le filtre de type", async () => {
    setup()
    await screen.findByText("media-0.png")
    expect(listCalls()[0]).toContain("kind=image")
    expect(screen.queryByRole("button", { name: /^Type/ })).toBeNull()
  })

  it("mode simple : garde la dernière tuile, Insérer désactivé sans sélection avec explication", async () => {
    const { onPick, onOpenChange } = setup({ mode: "single" })
    await screen.findByText("media-0.png")
    expect(insertBtn().disabled).toBe(true)
    fireEvent.focus(insertBtn().parentElement!)
    expect(within(insertBtn().parentElement!).getByRole("tooltip").textContent).toBe("Choisissez une image")
    fireEvent.click(screen.getByText("media-0.png"))
    fireEvent.click(screen.getByText("media-1.png"))
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1)
    fireEvent.click(insertBtn())
    await waitFor(() => expect(onPick).toHaveBeenCalled())
    const [items] = onPick.mock.calls[0]
    expect(items.map((i: { id: string }) => i.id)).toEqual(["m1"])
    expect(items[0].url).toBe("/api/media/m1")
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("mode multiple avec max : une troisième tuile est refusée avec un toast d'erreur", async () => {
    setup({ mode: "multiple", max: 2 })
    await screen.findByText("media-0.png")
    fireEvent.click(screen.getByText("media-0.png"))
    fireEvent.click(screen.getByText("media-1.png"))
    fireEvent.click(screen.getByText("media-2.png"))
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(2)
    expect(h.toastError).toHaveBeenCalledWith("Sélection limitée à 2")
  })

  it("le texte alternatif prérempli part dans onPick", async () => {
    listResponse = async () => ({
      ok: true,
      json: async () => ({ items: makeItems(1).map((i) => ({ ...i, altText: "Logo bleu" })), nextCursor: null }),
    })
    const { onPick } = setup({ showAlt: true })
    await screen.findByText("media-0.png")
    fireEvent.click(screen.getByText("media-0.png"))
    const input = screen.getByLabelText("Texte alternatif") as HTMLInputElement
    expect(input.value).toBe("Logo bleu")
    fireEvent.change(input, { target: { value: "Logo" } })
    fireEvent.click(insertBtn())
    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(onPick.mock.calls[0][1]).toEqual({ alt: "Logo" })
  })

  it("état d'erreur avec Réessayer, puis liste", async () => {
    listResponse = async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) })
    setup()
    const retry = await screen.findByRole("button", { name: "Réessayer" })
    listResponse = async () => ({ ok: true, json: async () => ({ items: makeItems(1), nextCursor: null }) })
    fireEvent.click(retry)
    await screen.findByText("media-0.png")
  })

  it("état vide", async () => {
    listResponse = async () => ({ ok: true, json: async () => ({ items: [], nextCursor: null }) })
    setup()
    expect(await screen.findByText("Aucun média")).toBeTruthy()
  })

  it("Entrée coche la tuile focalisée, Échap ferme sans onPick", async () => {
    const { onPick, onOpenChange } = setup()
    await screen.findByText("media-0.png")
    fireEvent.keyDown(tile("media-0.png"), { key: "Enter" })
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalled())
    expect(onOpenChange.mock.calls[0][0]).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
  })

  it("Annuler ferme sans onPick", async () => {
    const { onPick, onOpenChange } = setup()
    await screen.findByText("media-0.png")
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe("MediaPicker, espace, onglets et envois", () => {
  it("impose l'espace du contexte dans la requête de la médiathèque", async () => {
    setup({ spaceId: "s1" })
    await screen.findByText("media-0.png")
    expect(listCalls()[0]).toContain("spaceId=s1")
  })

  it("onglets : icône, info-bulle au clavier, aria-controls seulement pour l'actif", async () => {
    setup({ tabs: ["library", "upload", "url", "bank"] })
    await screen.findByText("media-0.png")
    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(4)
    tabs.forEach((t) => expect(t.querySelector("svg")).not.toBeNull())
    expect(tabs[0].getAttribute("aria-controls")).toBe("picker-panel-library")
    expect(document.getElementById("picker-panel-library")).not.toBeNull()
    tabs.slice(1).forEach((t) => expect(t.getAttribute("aria-controls")).toBeNull())
    fireEvent.mouseEnter(tabs[1].parentElement!)
    expect(within(tabs[1].parentElement!).getByRole("tooltip").textContent).toBe("Téléverser depuis cet appareil")
  })

  async function startUpload(send: SendFn) {
    const out = setup({ spaceId: "s1", tabs: ["library", "upload", "url"], uploadOptions: { send, hash: async () => "h", fetchDuplicates: async () => ({}) } })
    await screen.findByText("media-0.png")
    fireEvent.click(screen.getByRole("tab", { name: /Téléverser/ }))
    await waitFor(() => expect(screen.getByTestId("picker-drop-zone").getAttribute("aria-disabled")).toBeNull())
    const file = new File(["a"], "a.png", { type: "image/png" })
    fireEvent.drop(screen.getByTestId("picker-drop-zone"), { dataTransfer: { files: [file] } })
    return out
  }

  it("fermeture pendant un envoi : confirmation dans la modale, l'envoi est annulé si on ferme", async () => {
    let signal: AbortSignal | undefined
    const send: SendFn = (_f, _t, _p, s) =>
      new Promise((_res, rej) => {
        signal = s
        s.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
      })
    const { onOpenChange } = await startUpload(send)
    await waitFor(() => expect(signal).toBeDefined())
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("Un envoi est en cours")
    fireEvent.click(screen.getByRole("button", { name: "Continuer l'envoi" }))
    expect(screen.queryByRole("button", { name: "Continuer l'envoi" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await screen.findByRole("button", { name: "Continuer l'envoi" })
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Fermer et annuler l'envoi" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(signal?.aborted).toBe(true)
  })

  it("changer d'onglet pendant l'envoi : le résultat est sélectionné sans ramener sur la médiathèque", async () => {
    let finish: ((r: { status: number; body: Record<string, unknown> }) => void) | null = null
    const send: SendFn = () => new Promise((res) => (finish = res))
    await startUpload(send)
    await waitFor(() => expect(finish).not.toBeNull())
    fireEvent.click(screen.getByRole("tab", { name: /Adresse|URL/ }))
    finish!({ status: 201, body: { id: "m0" } })
    await screen.findByText("Sélection : 1")
    expect(screen.getByRole("tab", { name: /URL|Adresse/ }).getAttribute("aria-selected")).toBe("true")
  })

  it("annuler (corbeille) un lot téléversé le retire de la sélection", async () => {
    const send: SendFn = async () => ({ status: 201, body: { id: "m0" } })
    await startUpload(send)
    await screen.findByText("Sélection : 1")
    const action = h.toastSuccess.mock.calls.find((c) => c[1]?.action)?.[1].action
    expect(action).toBeDefined()
    await act(async () => {
      action.onClick()
    })
    await screen.findByText("Sélection : 0")
  })
})
