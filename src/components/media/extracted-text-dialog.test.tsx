// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { renderWithIntl } from "@/__tests__/components/support/render-intl"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { ExtractedTextDialog } from "./extracted-text-dialog"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const page = (text: string, over: Record<string, unknown> = {}) => ({
  status: "done", reason: null, source: "pdf", text, truncated: false, indexedAt: null, version: 1,
  totalChars: text.length, offset: 0, nextOffset: null, ...over,
})
const fetchMock = vi.fn()
const write = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  write.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal("fetch", fetchMock)
  Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const renderIt = (onSeek?: (s: number) => void) =>
  renderWithIntl(<ExtractedTextDialog mediaId="m1" name="contrat.pdf" open onOpenChange={() => {}} onSeek={onSeek} />)

describe("ExtractedTextDialog", () => {
  it("chargement puis texte en lecture seule", async () => {
    fetchMock.mockResolvedValue(json(page("Bonjour le contrat\nSuite")))
    renderIt()
    expect(screen.getByRole("status", { name: "Chargement du texte extrait" })).toBeTruthy()
    expect(await screen.findByText("Bonjour le contrat")).toBeTruthy()
    expect(screen.getByText(/contrat\.pdf · lecture seule/)).toBeTruthy()
  })

  it("recherche : compteur et navigation précédent/suivant", async () => {
    fetchMock.mockResolvedValue(json(page("contrat un\ncontrat deux")))
    renderIt()
    const input = await screen.findByLabelText("Rechercher dans le texte")
    fireEvent.change(input, { target: { value: "contrat" } })
    expect(await screen.findByText("1 sur 2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Résultat suivant" }))
    expect(screen.getByText("2 sur 2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Résultat précédent" }))
    expect(screen.getByText("1 sur 2")).toBeTruthy()
  })

  it("aucun résultat", async () => {
    fetchMock.mockResolvedValue(json(page("abc")))
    renderIt()
    fireEvent.change(await screen.findByLabelText("Rechercher dans le texte"), { target: { value: "zzz" } })
    expect(await screen.findByText("Aucun résultat")).toBeTruthy()
  })

  it("copie avec toast", async () => {
    fetchMock.mockResolvedValue(json(page("abc")))
    renderIt()
    fireEvent.click(await screen.findByRole("button", { name: "Copier le texte" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Texte copié"))
    expect(write).toHaveBeenCalledWith("abc")
  })

  it("texte tronqué : mention du plafond", async () => {
    fetchMock.mockResolvedValue(json(page("abc", { truncated: true })))
    renderIt()
    expect(await screen.findByText(/Texte tronqué à/)).toBeTruthy()
  })

  it("pages réunies quand le texte dépasse une page", async () => {
    fetchMock
      .mockResolvedValueOnce(json(page("AAA", { totalChars: 6, nextOffset: 3 })))
      .mockResolvedValueOnce(json(page("BBB", { totalChars: 6, offset: 3 })))
    renderIt()
    expect(await screen.findByText("AAABBB")).toBeTruthy()
    expect(fetchMock.mock.calls[1][0]).toBe("/api/media/m1/text?offset=3")
  })

  it("transcription : horodatage cliquable déplace le lecteur", async () => {
    const onSeek = vi.fn()
    fetchMock.mockResolvedValue(json(page("[00:14] Bonjour\n[02:05] Merci", { source: "transcript" })))
    renderIt(onSeek)
    fireEvent.click(await screen.findByRole("button", { name: "Lire à partir de 02:05" }))
    expect(onSeek).toHaveBeenCalledWith(125)
  })

  it("vide : état vide, recherche et copie désactivées avec raison", async () => {
    fetchMock.mockResolvedValue(json(page("", { status: "skipped", reason: "empty", text: null, totalChars: 0 })))
    renderIt()
    expect(await screen.findByText("Aucun texte extrait")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Copier le texte" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText("Rechercher dans le texte") as HTMLInputElement).disabled).toBe(true)
  })

  it("erreur : message et Réessayer", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500)).mockResolvedValue(json(page("abc")))
    renderIt()
    expect(await screen.findByRole("alert")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(await screen.findByText("abc")).toBeTruthy()
  })
})
