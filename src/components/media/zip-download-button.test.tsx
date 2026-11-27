// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
const toastMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { ZipDownloadButton, zipUrl } from "./zip-download-button"

const clicked: string[] = []
const fetchMock = vi.fn()

beforeEach(() => {
  clicked.length = 0
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.getAttribute("href") ?? "")
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  Object.values(toastMock).forEach((m) => m.mockReset())
})

const sel = { ids: ["a", "b", "c"] }
const open = () => fireEvent.click(screen.getByRole("button", { name: "Télécharger en archive" }))
const go = () => fireEvent.click(screen.getByRole("button", { name: "Télécharger l'archive" }))
const res = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) })

describe("ZipDownloadButton", () => {
  it("construit l'URL de la route, avec ou sans probe", () => {
    expect(zipUrl({ ids: ["a", "b"] }, true)).toBe("/api/media/zip?ids=a%2Cb&probe=1")
    expect(zipUrl({ folderId: "f" }, false)).toBe("/api/media/zip?folderId=f")
  })

  it("bouton avec nom accessible et info-bulle, dialogue avec jauges", () => {
    render(<ZipDownloadButton source={sel} fileCount={3} totalBytes={22 * 1024 * 1024} />)
    const btn = screen.getByRole("button", { name: "Télécharger en archive" })
    fireEvent.focus(btn)
    expect(screen.getByRole("tooltip").textContent).toBe("Télécharger en archive")
    open()
    expect(screen.getByText("Sélection de 3 médias")).toBeTruthy()
    expect(screen.getAllByRole("progressbar")).toHaveLength(2)
    expect(screen.getByText(/3 sur 500 au maximum/)).toBeTruthy()
  })

  it("désactivé avec la raison au-delà de 200 médias", () => {
    render(<ZipDownloadButton source={{ ids: Array(201).fill("x") }} fileCount={201} totalBytes={1} />)
    const btn = screen.getByRole("button", { name: "Télécharger en archive" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Plus de 200 médias sélectionnés : réduisez la sélection.")
  })

  it("désactivé avec la raison externe (aucun dossier choisi)", () => {
    render(<ZipDownloadButton variant="tree" source={{ folderId: "" }} fileCount={0} disabledReason="Choisissez un dossier" />)
    const btn = screen.getByRole("button", { name: "Télécharger le dossier en archive" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Choisissez un dossier")
  })

  it("sonde puis déclenche un lien de téléchargement, sans lire de blob", async () => {
    fetchMock.mockResolvedValue(res(204, { "X-Zip-Skipped": "0" }))
    render(<ZipDownloadButton source={sel} fileCount={3} totalBytes={10} />)
    open()
    go()
    await waitFor(() => expect(clicked).toEqual(["/api/media/zip?ids=a%2Cb%2Cc"]))
    expect(fetchMock.mock.calls[0][0]).toBe("/api/media/zip?ids=a%2Cb%2Cc&probe=1")
    expect(toastMock.info).toHaveBeenCalledWith("Préparation de l'archive lancée")
  })

  it("signale les fichiers non inclus", async () => {
    fetchMock.mockResolvedValue(res(204, { "X-Zip-Skipped": "2" }))
    render(<ZipDownloadButton source={sel} fileCount={3} totalBytes={10} />)
    open()
    go()
    await waitFor(() => expect(toastMock.info).toHaveBeenCalled())
    expect(toastMock.info.mock.calls[0][0]).toContain("2 fichiers non inclus")
  })

  it.each([
    [413, {}, "Archive trop volumineuse"],
    [429, { "Retry-After": "600" }, "Réessayez dans 10 min"],
    [429, { "Retry-After": "30" }, "déjà en cours"],
    [404, {}, "Aucun fichier lisible"],
    [500, {}, "Préparation de l'archive impossible"],
  ])("erreur %i : message dans le dialogue et toast, aucun lien", async (status, headers, text) => {
    fetchMock.mockResolvedValue(res(status, headers))
    render(<ZipDownloadButton source={sel} fileCount={3} totalBytes={10} />)
    open()
    go()
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(text))
    expect(toastMock.error).toHaveBeenCalled()
    expect(clicked).toEqual([])
  })

  it("coupure réseau : erreur claire", async () => {
    fetchMock.mockRejectedValue(new Error("net"))
    render(<ZipDownloadButton source={sel} fileCount={3} totalBytes={10} />)
    open()
    go()
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("impossible"))
  })

  it("« Annuler » ferme le dialogue", () => {
    render(<ZipDownloadButton source={sel} fileCount={3} totalBytes={10} />)
    open()
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
