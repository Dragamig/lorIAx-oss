// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { renderWithIntl } from "@/__tests__/components/support/render-intl"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
const user = vi.hoisted(() => ({ current: { globalRole: "member" } as { globalRole: string } | null }))
vi.mock("@/hooks/use-session", () => ({ useCurrentUser: () => user.current }))
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}))

import { IndexingSection } from "./indexing-section"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const state = (over: Record<string, unknown> = {}) => ({
  status: "done", reason: null, source: "pdf", text: "x", truncated: false,
  indexedAt: "2026-11-24T14:32:00.000Z", version: 1, totalChars: 41200, offset: 0, nextOffset: null, ...over,
})
const fetchMock = vi.fn()
let current: Record<string, unknown>
let reindexRes: Response

beforeEach(() => {
  current = state()
  reindexRes = json({ status: "pending" })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return reindexRes
    return json(current)
  })
  vi.stubGlobal("fetch", fetchMock)
  user.current = { globalRole: "member" }
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const renderIt = (canWrite = true) => renderWithIntl(<IndexingSection mediaId="m1" canWrite={canWrite} name="contrat.pdf" />)

describe("IndexingSection", () => {
  it("chargement puis état indexé avec source et caractères", async () => {
    renderIt()
    expect(screen.getByRole("status", { name: "Chargement de l'état d'indexation" })).toBeTruthy()
    expect(await screen.findByText("Indexé")).toBeTruthy()
    expect(screen.getByText("PDF")).toBeTruthy()
    expect(screen.getByText(/41.*200 caractères/)).toBeTruthy()
  })

  it.each([
    [{ status: "pending" }, "En attente"],
    [{ status: "running" }, "En cours"],
    [{ status: "skipped", reason: "too_long", text: null, totalChars: 0 }, "Ignoré, média trop long"],
    [{ status: "skipped", reason: "empty", text: null, totalChars: 0 }, "Aucun texte trouvé"],
    [{ status: "failed", reason: "extract_error", text: null, totalChars: 0 }, "Échec de l'indexation"],
    [{ status: "pending", reason: "daily_quota" }, "Quota IA atteint"],
    [{ status: "pending", reason: "no_engine" }, "Moteur indisponible"],
    [{ status: "pending", reason: "daily_cap" }, "Plafond journalier atteint"],
    [{ status: "disabled", text: null, totalChars: 0 }, "Désactivée par l'organisation"],
  ])("pastille %j", async (over, badge) => {
    current = state(over)
    renderIt()
    expect(await screen.findByText(badge)).toBeTruthy()
  })

  it("type non indexable : rien n'est rendu", async () => {
    current = state({ status: "unsupported" })
    const { container } = renderIt()
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
    expect(container.textContent).toBe("")
  })

  it("désactivé : lien vers les réglages pour un admin seulement", async () => {
    current = state({ status: "disabled", text: null, totalChars: 0 })
    user.current = { globalRole: "admin" }
    renderIt()
    const link = await screen.findByRole("link", { name: /Ouvrir les réglages IA/ })
    expect(link.getAttribute("href")).toBe("/admin/library")
    cleanup()
    user.current = { globalRole: "member" }
    renderIt()
    await screen.findByText(/Un administrateur peut activer/)
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("lecteur : Réindexer désactivé avec la raison en info-bulle", async () => {
    renderIt(false)
    const btn = await screen.findByRole("button", { name: "Réindexer" })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBeTruthy()
    expect(screen.getAllByRole("tooltip", { hidden: true }).some((n) => n.textContent === "Réservé aux personnes qui peuvent modifier ce média")).toBe(true)
  })

  it("en attente : Réindexer désactivé car déjà en file", async () => {
    current = state({ status: "pending" })
    renderIt()
    const btn = await screen.findByRole("button", { name: "Réindexer" })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it("Réindexer : POST, toast de succès", async () => {
    renderIt()
    fireEvent.click(await screen.findByRole("button", { name: "Réindexer" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Réindexation demandée"))
    expect(fetchMock).toHaveBeenCalledWith("/api/media/m1/reindex", { method: "POST" })
  })

  it("plafond atteint : toast d'erreur explicite", async () => {
    reindexRes = json({ code: "daily_cap" }, 429)
    renderIt()
    fireEvent.click(await screen.findByRole("button", { name: "Réindexer" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Plafond quotidien atteint, réessayez demain"))
  })

  it("échec : bouton Réessayer", async () => {
    current = state({ status: "failed", reason: "extract_error", text: null, totalChars: 0 })
    renderIt()
    expect(await screen.findByRole("button", { name: "Réessayer" })).toBeTruthy()
  })

  it("erreur réseau : message et Réessayer", async () => {
    fetchMock.mockImplementationOnce(async () => json({}, 500))
    renderIt()
    expect(await screen.findByRole("alert")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(await screen.findByText("Indexé")).toBeTruthy()
  })

  it("Voir le texte extrait ouvre le panneau", async () => {
    renderIt()
    fireEvent.click(await screen.findByRole("button", { name: "Voir le texte extrait" }))
    expect(await screen.findByRole("dialog")).toBeTruthy()
  })
})
