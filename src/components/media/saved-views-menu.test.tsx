// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { SWRConfig } from "swr"
import type { MediaFilters } from "@/lib/media/filters"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
const toastMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { SavedViewsMenu, summarizeQuery } from "./saved-views-menu"

const fetchMock = vi.fn()
const baseFilters = { view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50 } as MediaFilters
const mineView = { id: "11111111-1111-4111-8111-111111111111", name: "Logos", query: "kind=image&sort=filename", shared: false, mine: true }
const sharedView = { id: "22222222-2222-4222-8222-222222222222", name: "Charte", query: "kind=pdf", shared: true, mine: false }

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

function setup(over: { filters?: MediaFilters; isAdmin?: boolean } = {}) {
  const onApplyQuery = vi.fn()
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SavedViewsMenu
        filters={over.filters ?? baseFilters}
        folders={[]}
        tags={[]}
        isAdmin={over.isAdmin}
        onApplyQuery={onApplyQuery}
      />
    </SWRConfig>
  )
  return { onApplyQuery }
}
const openMenu = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Vues enregistrées" }))
  await screen.findByRole("button", { name: "Enregistrer la vue actuelle" })
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  Object.values(toastMock).forEach((m) => m.mockReset())
})

describe("SavedViewsMenu", () => {
  it("liste les vues Personnelles puis Partagées", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [mineView], shared: [sharedView] }))
    setup()
    await openMenu()
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(["Personnelles", "Partagées avec l'organisation"])
    expect(screen.getByRole("button", { name: "Appliquer la vue Logos" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Appliquer la vue Charte" })).toBeTruthy()
  })

  it("état vide", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [], shared: [] }))
    setup()
    await openMenu()
    expect(screen.getByText("Aucune vue enregistrée")).toBeTruthy()
  })

  it("état de chargement", () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    setup()
    fireEvent.click(screen.getByRole("button", { name: "Vues enregistrées" }))
    expect(screen.getByRole("status", { name: "Chargement des vues" })).toBeTruthy()
  })

  it("erreur puis Réessayer recharge", async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}))
    setup()
    fireEvent.click(screen.getByRole("button", { name: "Vues enregistrées" }))
    const retry = await screen.findByRole("button", { name: "Réessayer" })
    fetchMock.mockResolvedValue(json(200, { mine: [mineView], shared: [] }))
    fireEvent.click(retry)
    await screen.findByRole("button", { name: "Appliquer la vue Logos" })
  })

  it("appliquer une vue transmet sa requête et annonce", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [mineView], shared: [] }))
    const { onApplyQuery } = setup()
    await openMenu()
    fireEvent.click(screen.getByRole("button", { name: "Appliquer la vue Logos" }))
    expect(onApplyQuery).toHaveBeenCalledWith("kind=image&sort=filename")
    expect(toastMock.info).toHaveBeenCalledWith("Vue « Logos » appliquée")
  })

  it("la vue dont la requête égale les filtres courants est marquée active", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [mineView], shared: [] }))
    setup({ filters: { ...baseFilters, kinds: ["image"], sort: "filename" } })
    await waitFor(() => expect(screen.getByRole("button", { name: "Vues enregistrées" }).textContent).toContain("Logos"))
  })

  it("modification et suppression absentes sur la vue partagée d'un autre, présentes pour un admin", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [], shared: [sharedView] }))
    setup()
    await openMenu()
    expect(screen.queryByRole("button", { name: "Modifier la vue Charte" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Supprimer la vue Charte" })).toBeNull()
    cleanup()
    setup({ isAdmin: true })
    await openMenu()
    expect(screen.getByRole("button", { name: "Modifier la vue Charte" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Supprimer la vue Charte" })).toBeTruthy()
  })

  it("boutons d'action : icône masquée, nom accessible et info-bulle au focus", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [mineView], shared: [] }))
    setup()
    await openMenu()
    const del = screen.getByRole("button", { name: "Supprimer la vue Logos" })
    expect(del.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    fireEvent.focus(del)
    expect(screen.getByRole("tooltip").textContent).toBe("Supprimer la vue Logos")
  })

  it("Enregistrer la vue actuelle désactivé sans filtre, avec la raison", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [], shared: [] }))
    setup()
    await openMenu()
    const btn = screen.getByRole("button", { name: "Enregistrer la vue actuelle" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Aucun filtre actif à enregistrer")
  })

  it("Enregistrer la vue actuelle désactivé à 50 vues", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...mineView, id: `id${i}`, name: `v${i}`, query: `q=${i}` }))
    fetchMock.mockResolvedValue(json(200, { mine: many, shared: [] }))
    setup({ filters: { ...baseFilters, kinds: ["pdf"] } })
    await openMenu()
    expect((screen.getByRole("button", { name: "Enregistrer la vue actuelle" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("création : dialogue (nom, partage), POST avec les filtres courants, toast", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { mine: [], shared: [] }))
    setup({ filters: { ...baseFilters, kinds: ["pdf"] } })
    await openMenu()
    fetchMock.mockResolvedValue(json(201, { view: { ...mineView, name: "PDF", shared: true } }))
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la vue actuelle" }))
    const dlg = await screen.findByRole("dialog")
    expect((within(dlg).getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dlg).getByLabelText("Nom de la vue"), { target: { value: "PDF" } })
    fireEvent.click(within(dlg).getByRole("checkbox"))
    fireEvent.click(within(dlg).getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Vue « PDF » enregistrée et partagée"))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!
    expect(post[0]).toBe("/api/media/views")
    expect(JSON.parse(post[1].body)).toEqual({ name: "PDF", query: "kind=pdf", shared: true })
  })

  it("doublon de nom refusé avec message", async () => {
    fetchMock.mockResolvedValue(json(200, { mine: [mineView], shared: [] }))
    setup({ filters: { ...baseFilters, kinds: ["pdf"] } })
    await openMenu()
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la vue actuelle" }))
    const dlg = await screen.findByRole("dialog")
    fireEvent.change(within(dlg).getByLabelText("Nom de la vue"), { target: { value: "logos" } })
    fireEvent.click(within(dlg).getByRole("button", { name: "Enregistrer" }))
    expect((await within(dlg).findByRole("alert")).textContent).toBe("Une de vos vues porte déjà ce nom.")
  })

  it("erreur 409 du serveur sur le nom : message de doublon", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { mine: [], shared: [] }))
    setup({ filters: { ...baseFilters, kinds: ["pdf"] } })
    await openMenu()
    fetchMock.mockResolvedValue(json(409, { error: "Une vue porte déjà ce nom" }))
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la vue actuelle" }))
    const dlg = await screen.findByRole("dialog")
    fireEvent.change(within(dlg).getByLabelText("Nom de la vue"), { target: { value: "X" } })
    fireEvent.click(within(dlg).getByRole("button", { name: "Enregistrer" }))
    expect((await within(dlg).findByRole("alert")).textContent).toBe("Une de vos vues porte déjà ce nom.")
  })

  it("modification : PATCH nom et partage", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { mine: [mineView], shared: [] }))
    setup()
    await openMenu()
    fetchMock.mockResolvedValue(json(200, { view: mineView }))
    fireEvent.click(screen.getByRole("button", { name: "Modifier la vue Logos" }))
    const dlg = await screen.findByRole("dialog")
    expect((within(dlg).getByLabelText("Nom de la vue") as HTMLInputElement).value).toBe("Logos")
    fireEvent.change(within(dlg).getByLabelText("Nom de la vue"), { target: { value: "Logos 2" } })
    fireEvent.click(within(dlg).getByRole("checkbox"))
    fireEvent.click(within(dlg).getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Vue « Logos 2 » mise à jour"))
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH")!
    expect(patch[0]).toBe(`/api/media/views/${mineView.id}`)
    expect(JSON.parse(patch[1].body)).toEqual({ name: "Logos 2", shared: true })
  })

  it("suppression : toast Annuler qui recrée la vue avec les mêmes valeurs", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { mine: [{ ...mineView, shared: true }], shared: [] }))
    setup()
    await openMenu()
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) })
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la vue Logos" }))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    const [msg, opts] = toastMock.success.mock.calls[0]
    expect(msg).toBe("Vue « Logos » supprimée")
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(true)
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(json(201, { view: mineView }))
    opts.action.onClick()
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Vue « Logos » rétablie"))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!
    expect(JSON.parse(post[1].body)).toEqual({ name: "Logos", query: mineView.query, shared: true })
  })

  it("échec de suppression : toast d'erreur", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { mine: [mineView], shared: [] }))
    setup()
    await openMenu()
    fetchMock.mockResolvedValue(json(500, {}))
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la vue Logos" }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Suppression impossible."))
  })
})

describe("summarizeQuery", () => {
  const t = (k: string) => k
  const ctx = { folders: [{ id: "f1", name: "Marque" }], tags: [], tFilters: t, tSort: t, t }
  it("résume dossier, types, recherche et tri", () => {
    expect(summarizeQuery("folderId=f1&kind=image&q=logo&sort=filename", ctx)).toEqual([
      "Marque",
      "kinds.image",
      "« logo »",
      "filename",
    ])
  })
  it("requête vide : tous les médias ; paramètre périmé sans erreur", () => {
    expect(summarizeQuery("", ctx)).toEqual(["allMedia"])
    expect(summarizeQuery("folderId=gone", ctx)).toEqual(["folderCrit"])
  })
})
