// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { renderWithIntl } from "@/__tests__/components/support/render-intl"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { MediaAiSettings } from "./ai-settings"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const base = {
  indexEnabled: false, transcribeEnabled: false, embeddingConfigured: true, whisperAvailable: true,
  pending: 0, indexed: 0, failed: 0, estimate: { media: 412, chunks: 9800, audioVideo: 38 },
}
const fetchMock = vi.fn()
let data: typeof base

beforeEach(() => {
  // jsdom n'a pas PointerEvent, que le Switch émet au clic.
  if (!("PointerEvent" in window)) Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true })
  data = { ...base }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const patch = JSON.parse(String(init.body))
      data = { ...data, ...patch }
      return json({ indexEnabled: data.indexEnabled, transcribeEnabled: data.transcribeEnabled })
    }
    if (init?.method === "DELETE") return json({ deleted: 3 })
    return json(data)
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("MediaAiSettings", () => {
  it("chargement puis interrupteurs désactivés par défaut et plafonds en lecture seule", async () => {
    renderWithIntl(<MediaAiSettings />)
    expect(screen.getByRole("status", { name: "Chargement des réglages IA" })).toBeTruthy()
    const sw = await screen.findByRole("switch", { name: "Indexer le texte et les vecteurs" })
    expect(sw.getAttribute("aria-checked")).toBe("false")
    expect(screen.getByRole("switch", { name: "Transcrire l'audio et la vidéo" }).getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText("300 maximum")).toBeTruthy()
    expect(screen.getByText("120 minutes maximum")).toBeTruthy()
    expect(screen.getByText("200 000 caractères")).toBeTruthy()
  })

  it("sans fournisseur d'embedding : interrupteur grisé et raison", async () => {
    data = { ...base, embeddingConfigured: false }
    renderWithIntl(<MediaAiSettings />)
    const sw = await screen.findByRole("switch", { name: "Indexer le texte et les vecteurs" })
    expect(sw.hasAttribute("data-disabled") || (sw as HTMLButtonElement).disabled || sw.getAttribute("aria-disabled") === "true").toBe(true)
    expect(screen.getAllByText(/Aucun fournisseur d'embedding/).length).toBeGreaterThan(0)
  })

  it("transcription grisée tant que l'indexation est éteinte", async () => {
    renderWithIntl(<MediaAiSettings />)
    const tr = await screen.findByRole("switch", { name: "Transcrire l'audio et la vidéo" })
    expect(tr.hasAttribute("data-disabled") || tr.getAttribute("aria-disabled") === "true").toBe(true)
    expect(screen.getAllByText("Activez d'abord l'indexation du texte").length).toBeGreaterThan(0)
  })

  it("activer ouvre la modale avec les estimations, puis PUT et toast Annuler", async () => {
    renderWithIntl(<MediaAiSettings />)
    fireEvent.click(await screen.findByRole("switch", { name: "Indexer le texte et les vecteurs" }))
    const dlg = await screen.findByRole("dialog")
    expect(within(dlg).getByText("412")).toBeTruthy()
    expect(within(dlg).getByText(/9.800/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole("button", { name: "Activer et indexer" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Indexation activée", expect.objectContaining({ action: expect.objectContaining({ label: "Annuler" }) })))
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT")!
    expect(JSON.parse(put[1].body)).toEqual({ indexEnabled: true })
  })

  it("désactiver : écriture directe sans modale, toast avec Annuler qui rétablit", async () => {
    data = { ...base, indexEnabled: true, indexed: 5 }
    renderWithIntl(<MediaAiSettings />)
    fireEvent.click(await screen.findByRole("switch", { name: "Indexer le texte et les vecteurs" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Indexation désactivée", expect.anything()))
    expect(screen.queryByRole("dialog")).toBeNull()
    const opts = toast.success.mock.calls[0][1] as { action: { onClick: () => void } }
    opts.action.onClick()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Réglage rétabli"))
    const puts = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT")
    expect(JSON.parse(puts[1][1].body)).toEqual({ indexEnabled: true, transcribeEnabled: false })
  })

  it("Effacer l'index : modale puis DELETE", async () => {
    data = { ...base, indexEnabled: true, indexed: 87 }
    renderWithIntl(<MediaAiSettings />)
    fireEvent.click(await screen.findByRole("button", { name: "Effacer l'index de l'organisation" }))
    const dlg = await screen.findByRole("dialog")
    expect(within(dlg).getByText(/87 médias/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole("button", { name: "Effacer l'index" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Index effacé"))
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(true)
  })

  it("Effacer l'index désactivé quand rien n'est indexé", async () => {
    renderWithIntl(<MediaAiSettings />)
    const btn = await screen.findByRole("button", { name: "Effacer l'index de l'organisation" })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it("rattrapage en cours : progression", async () => {
    data = { ...base, indexEnabled: true, indexed: 87, pending: 325 }
    renderWithIntl(<MediaAiSettings />)
    expect(await screen.findByText(/Rattrapage en cours/)).toBeTruthy()
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("21")
  })

  it("erreur de chargement : message et Réessayer", async () => {
    fetchMock.mockImplementationOnce(async () => json({}, 500))
    renderWithIntl(<MediaAiSettings />)
    expect(await screen.findByRole("alert")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(await screen.findByRole("switch", { name: "Indexer le texte et les vecteurs" })).toBeTruthy()
  })

  it("échec d'écriture : toast d'erreur, état inchangé", async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => (init?.method === "PUT" ? json({}, 500) : json(data)))
    data = { ...base, indexEnabled: true }
    renderWithIntl(<MediaAiSettings />)
    const sw = await screen.findByRole("switch", { name: "Indexer le texte et les vecteurs" })
    fireEvent.click(sw)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Enregistrement impossible"))
    expect(sw.getAttribute("aria-checked")).toBe("true")
  })
})
