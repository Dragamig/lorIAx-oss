// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { readFileSync, readdirSync } from "fs"
import { resolve } from "path"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { VersionsTab } from "./versions-tab"

type V = { id: string; mediaId: string; version: number; filename: string; mimeType: string; sizeBytes: number; width: null; height: null; pageCount: null; createdBy: string; createdByName: string | null; createdAt: string; comment: string | null; restoredFrom: number | null; hasThumbnail: boolean }
const mk = (version: number, over: Partial<V> = {}): V => ({
  id: `v${version}`, mediaId: "m1", version, filename: `logo-${version}.png`, mimeType: "image/png", sizeBytes: 2048 * version,
  width: null, height: null, pageCount: null, createdBy: "u1", createdByName: null, createdAt: "2026-11-20T10:00:00.000Z", comment: null, restoredFrom: null, hasThumbnail: true, ...over,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let versions: V[]
let current: number
let listStatus = 200
const fetchMock = vi.fn()

beforeEach(() => {
  versions = [mk(3, { restoredFrom: 1, comment: "Palette" }), mk(2), mk(1)]
  current = 3
  listStatus = 200
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/media/m1/versions" && !init) return listStatus === 200 ? json({ currentVersion: current, versions }) : json({ error: "x" }, listStatus)
    return json({ version: mk(4), media: { currentVersion: 4 } })
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderTab = (over: Partial<Parameters<typeof VersionsTab>[0]> = {}) =>
  render(<VersionsTab mediaId="m1" currentVersion={3} canWrite inTrash={false} usageCount={4} {...over} />)

describe("VersionsTab", () => {
  it("affiche le squelette de chargement puis la liste de la maquette", async () => {
    renderTab()
    expect(screen.getByRole("status", { name: "Chargement des versions" })).toBeTruthy()
    const list = await screen.findByRole("list", { name: "Versions du fichier" })
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText("Courante")).toBeTruthy()
    expect(within(items[0]).getByText("Restaurée de v1")).toBeTruthy()
    expect(within(items[0]).getByText("Palette")).toBeTruthy()
    expect(screen.getByText("3 sur 20 versions")).toBeTruthy()
    expect(screen.getByRole("progressbar", { name: "Versions conservées" }).getAttribute("aria-valuenow")).toBe("3")
  })

  it("erreur de chargement : Réessayer recharge la liste", async () => {
    listStatus = 500
    renderTab()
    expect(await screen.findByRole("alert")).toBeTruthy()
    listStatus = 200
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(await screen.findByRole("list", { name: "Versions du fichier" })).toBeTruthy()
  })

  it("état vide : une seule version, supprimer désactivé avec raison", async () => {
    versions = [mk(1)]
    current = 1
    renderTab({ currentVersion: 1 })
    expect(await screen.findByText("Une seule version")).toBeTruthy()
    const del = screen.getByRole("button", { name: "Supprimer la version 1" }) as HTMLButtonElement
    expect(del.disabled).toBe(true)
    expect(screen.getByText("Seule version : elle ne peut pas être supprimée")).toBeTruthy()
  })

  it("la courante ne peut ni être supprimée ni restaurée, chaque bouton a un nom accessible", async () => {
    renderTab()
    await screen.findByRole("list", { name: "Versions du fichier" })
    expect((screen.getByRole("button", { name: "Supprimer la version 3" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("La version courante ne peut pas être supprimée")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Restaurer la version 3" }) as HTMLButtonElement).disabled).toBe(true)
    for (const n of [1, 2]) {
      expect((screen.getByRole("button", { name: `Supprimer la version ${n}` }) as HTMLButtonElement).disabled).toBe(false)
      expect((screen.getByRole("button", { name: `Restaurer la version ${n}` }) as HTMLButtonElement).disabled).toBe(false)
      expect(screen.getByRole("button", { name: `Télécharger la version ${n}` })).toBeTruthy()
    }
  })

  it("corbeille : remplacer, restaurer et supprimer désactivés avec l'info-bulle de la maquette", async () => {
    renderTab({ inTrash: true })
    await screen.findByRole("list", { name: "Versions du fichier" })
    for (const name of ["Remplacer le fichier", "Restaurer la version 2", "Supprimer la version 2"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getAllByText("Média en corbeille : restaurez-le pour modifier ses versions").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Télécharger la version 2" })).toBeTruthy()
  })

  it("sans droit d'écriture : actions d'écriture désactivées", async () => {
    renderTab({ canWrite: false })
    await screen.findByRole("list", { name: "Versions du fichier" })
    expect((screen.getByRole("button", { name: "Remplacer le fichier" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Supprimer la version 2" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("limite de 20 atteinte : le dit, sans bloquer le remplacement", async () => {
    versions = Array.from({ length: 20 }, (_, i) => mk(20 - i))
    current = 20
    renderTab({ currentVersion: 20 })
    expect(await screen.findByText("Limite atteinte")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Remplacer le fichier" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("affiche le nom de l'auteur quand il est connu", async () => {
    versions = [mk(3, { createdByName: "Camille Dupont" }), mk(2), mk(1)]
    renderTab()
    await screen.findByRole("list", { name: "Versions du fichier" })
    expect(screen.getByText(/Camille Dupont/)).toBeTruthy()
    expect(screen.getAllByText(/Camille Dupont/)).toHaveLength(1)
  })

  it("VERSIONS_LIMIT client égale MEDIA_VERSIONS_MAX serveur", async () => {
    const { MEDIA_VERSIONS_MAX } = await vi.importActual<typeof import("@/lib/media/versions")>("@/lib/media/versions")
    const { VERSIONS_LIMIT } = await import("@/lib/media/version-dto")
    expect(VERSIONS_LIMIT).toBe(MEDIA_VERSIONS_MAX)
  })

  it("restauration : POST avec la version attendue, toast avec Annuler qui supprime la version créée", async () => {
    renderTab()
    await screen.findByRole("list", { name: "Versions du fichier" })
    fireEvent.click(screen.getByRole("button", { name: "Restaurer la version 2" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/media/m1/versions/2/restore")!
    expect(JSON.parse(String(call[1].body))).toEqual({ expectedVersion: 3 })
    const [message, opts] = toast.success.mock.calls[0]
    expect(message).toBe("Version 2 restaurée : version 4 créée")
    expect(opts.action.label).toBe("Annuler")
    opts.action.onClick()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media/m1/versions/v4?requireCurrent=1", { method: "DELETE" }))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Restauration annulée"))
  })

  it("restauration refusée en 409 : message de conflit et rechargement", async () => {
    renderTab()
    await screen.findByRole("list", { name: "Versions du fichier" })
    fetchMock.mockImplementationOnce(async () => json({ error: "Version périmée" }, 409))
    const before = fetchMock.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Restaurer la version 2" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Un collègue vient de remplacer ce fichier")))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before + 1))
  })

  it("suppression : modale maison de confirmation, DELETE puis toast", async () => {
    const confirmSpy = vi.fn()
    vi.stubGlobal("confirm", confirmSpy)
    renderTab()
    await screen.findByRole("list", { name: "Versions du fichier" })
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la version 2" }))
    expect(await screen.findByText(/sera supprimée définitivement/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalledWith("/api/media/m1/versions/v2", { method: "DELETE" })
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media/m1/versions/v2", { method: "DELETE" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Version 2 supprimée"))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it("remplacement : confirme avec le nombre d'usages, toast avec Annuler = DELETE de la version créée", async () => {
    renderTab()
    await screen.findByRole("list", { name: "Versions du fichier" })
    fireEvent.click(screen.getByRole("button", { name: "Remplacer le fichier" }))
    expect(await screen.findByText("Utilisé dans 4 contenus : tous afficheront la nouvelle version.")).toBeTruthy()
    const input = screen.getByTestId("replace-file-input")
    fireEvent.change(input, { target: { files: [new File(["x"], "nouveau.png", { type: "image/png" })] } })
    fireEvent.click(screen.getByRole("button", { name: "Remplacer" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/media/m1/versions" && c[1]?.method === "POST")!
    expect((post[1].body as FormData).get("expectedVersion")).toBe("3")
    const [message, opts] = toast.success.mock.calls[0]
    expect(message).toBe("Fichier remplacé : version 4 créée")
    opts.action.onClick()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media/m1/versions/v4?requireCurrent=1", { method: "DELETE" }))
  })

  it("aucun alert, confirm ni prompt natif dans les composants de version", () => {
    for (const f of ["versions-tab.tsx", "replace-file-dialog.tsx"]) {
      const src = readFileSync(resolve(__dirname, f), "utf-8")
      expect(src).not.toMatch(/\b(window\.)?(alert|confirm|prompt)\(/)
    }
  })

  it("les 7 locales ont toutes les clés de l'onglet Versions", () => {
    const dir = resolve(__dirname, "../../../messages")
    const fr = JSON.parse(readFileSync(resolve(dir, "fr.json"), "utf-8")).library
    const need = Object.keys(fr.versions).sort()
    const actions = ["replaceFile", "chooseReplacement", "confirmReplace", "restoreVersion", "downloadVersion", "deleteVersion", "confirmDeleteVersion", "retryVersions"]
    const locales = readdirSync(dir).filter((f) => f.endsWith(".json"))
    expect(locales.length).toBe(7)
    for (const f of locales) {
      const lib = JSON.parse(readFileSync(resolve(dir, f), "utf-8")).library
      expect(Object.keys(lib.versions).sort(), f).toEqual(need)
      for (const a of actions) expect(typeof lib.actions[a], `${f} ${a}`).toBe("string")
    }
  })
})
