// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import fr from "../../../messages/fr.json"
import {
  CreateFolderDialog,
  DeleteFolderDialog,
  MoveFolderDialog,
  RenameFolderDialog,
} from "./folder-dialogs"

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string, vars?: Record<string, string>) => {
    const full = ns ? `${ns}.${key}` : key
    const raw = full.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], fr)
    return String(raw).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? "")
  },
}))

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const folder = { id: "f1", parentId: null, name: "Direction", mediaCount: 0 }

describe("CreateFolderDialog", () => {
  it("nom vide : message sous le champ, aucun appel", async () => {
    render(<CreateFolderDialog open onOpenChange={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "Créer" }))
    expect((await screen.findByRole("alert")).textContent).toBe("Le nom du dossier est requis.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("erreur de l'API affichée sous le champ", async () => {
    fetchMock.mockReturnValueOnce(reply(409, { error: "Un dossier de ce nom existe déjà à cet endroit" }))
    render(<CreateFolderDialog open onOpenChange={() => {}} onDone={() => {}} />)
    fireEvent.change(screen.getByLabelText("Nom du dossier"), { target: { value: "Doc" } })
    fireEvent.click(screen.getByRole("button", { name: "Créer" }))
    expect((await screen.findByRole("alert")).textContent).toContain("existe déjà")
  })

  it("création : toast avec Annuler qui supprime le dossier créé", async () => {
    const onDone = vi.fn()
    fetchMock.mockReturnValueOnce(reply(201, { folder: { ...folder, name: "Doc" } }))
    render(<CreateFolderDialog open onOpenChange={() => {}} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText("Nom du dossier"), { target: { value: " Doc " } })
    fireEvent.click(screen.getByRole("button", { name: "Créer" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Doc", parentId: null })
    const opts = toastSuccess.mock.calls[0][1]
    expect(opts.action.label).toBe("Annuler")
    fetchMock.mockReturnValueOnce(reply(200, {}))
    opts.action.onClick()
    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toBe("/api/media/folders/f1"))
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE")
  })
})

describe("RenameFolderDialog", () => {
  it("renomme puis l'annulation remet l'ancien nom", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { folder: {} }))
    render(<RenameFolderDialog open onOpenChange={() => {}} onDone={() => {}} folder={folder} />)
    fireEvent.change(screen.getByLabelText("Nom du dossier"), { target: { value: "Nouveau" } })
    fireEvent.click(screen.getByRole("button", { name: "Renommer" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    fetchMock.mockReturnValueOnce(reply(200, {}))
    toastSuccess.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ name: "Direction" })
  })
})

describe("MoveFolderDialog", () => {
  it("n'offre ni le dossier ni ses descendants comme parent", () => {
    const folders = [
      folder,
      { id: "f2", parentId: "f1", name: "Enfant", mediaCount: 0 },
      { id: "f3", parentId: null, name: "Autre", mediaCount: 0 },
    ]
    render(<MoveFolderDialog open onOpenChange={() => {}} onDone={() => {}} folder={folder} folders={folders} />)
    const labels = screen.getAllByRole("option").map((o) => o.textContent)
    expect(labels).toEqual(["Racine", "Autre"])
  })
})

describe("DeleteFolderDialog", () => {
  it("supprime puis toast avec Annuler qui appelle restore avec la charge undo", async () => {
    const undo = { folderId: "f1", parentId: null, name: "Direction", mediaIds: ["m"], childIds: [] }
    fetchMock.mockReturnValueOnce(reply(200, { movedMedia: 1, movedChildren: 0, undo }))
    render(<DeleteFolderDialog open onOpenChange={() => {}} onDone={() => {}} folder={folder} />)
    expect(screen.getByText(/remontent d'un niveau/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    const opts = toastSuccess.mock.calls[0][1]
    expect(opts.action.label).toBe("Annuler")
    fetchMock.mockReturnValueOnce(reply(201, {}))
    opts.action.onClick()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/media/folders/restore")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ undo })
  })
})
