// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { makeItems, mockLayout } from "./test-fixtures"

const h = vi.hoisted(() => ({ list: {} as Record<string, unknown>, mutate: vi.fn(), swrMutate: vi.fn() }))
const toastSuccess = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t1"))
const toastError = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t2"))

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: vi.fn() } }))
vi.mock("./use-library-filters", () => ({
  useLibraryFilters: () => ({
    filters: { view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50 },
    reset: vi.fn(),
    hasActiveFilters: false,
    setFilters: vi.fn(),
  }),
}))
vi.mock("./use-media-list", () => ({ useMediaList: () => ({ ...h.list }) }))
vi.mock("./upload-tray", () => ({ UploadTray: () => null }))
vi.mock("swr", () => ({
  default: (key: string) => {
    const data: Record<string, unknown> = {
      "/api/media/stats": { total: 4, unused: 0, mine: 0, trash: 0, orphan: 0, noFolder: 4, byFolder: {}, byTag: [], usedBytes: 1, limitBytes: 100, percent: 1 },
      "/api/media/folders": { folders: [{ id: "f1", parentId: null, name: "Direction", mediaCount: 0 }, { id: "f2", parentId: null, name: "Archives", mediaCount: 0 }] },
      "/api/spaces": [{ id: "s1", name: "Espace A" }],
    }
    return { data: data[key], mutate: h.swrMutate, error: undefined }
  },
}))
vi.mock("./use-upload-queue", () => ({
  useUploadQueue: () => ({ add: vi.fn(), cancel: vi.fn(), retry: vi.fn(), resolveDuplicate: vi.fn(), clearFinished: vi.fn(), subscribe: () => () => {}, snapshot: () => [] }),
  useQueueSnapshot: () => [],
  useBatchToast: () => {},
}))

import { LibraryPage } from "./library-page"

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
let batchCalls: Record<string, unknown>[]
let folderCalls: { url: string; body: Record<string, unknown> }[]
const dt = () => ({ types: [] as string[], setData: vi.fn(), effectAllowed: "" })
const tile = (id: string) => document.querySelector<HTMLElement>(`[data-media-tile][data-media-id="${id}"]`)!

beforeEach(() => {
  mockLayout()
  batchCalls = []
  folderCalls = []
  toastSuccess.mockClear()
  toastError.mockClear()
  h.mutate.mockReset()
  h.list = { items: makeItems(4), isLoading: false, isError: false, isValidating: false, hasMore: false, loadMore: vi.fn(), mutate: h.mutate }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/media/batch") {
        const body = JSON.parse(String(init!.body))
        batchCalls.push(body)
        return json({ results: (body.ids as string[]).map((id) => ({ id, ok: true, previous: { folderId: null, deletedAt: null } })) })
      }
      if (url.startsWith("/api/media/folders/")) {
        folderCalls.push({ url, body: JSON.parse(String(init!.body)) })
        return json({ folder: {} })
      }
      if (url === "/api/media/usages-summary") return json({ perMedia: {}, trashRetentionDays: 30 })
      return json({})
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function selectFirstTwo() {
  fireEvent.click(tile("m0"), { ctrlKey: true })
  fireEvent.click(tile("m1"), { ctrlKey: true })
}

describe("LibraryPage, actions groupées", () => {
  it("barre groupée absente sans sélection, visible dès une sélection", () => {
    render(<LibraryPage />)
    expect(screen.queryByRole("toolbar", { name: "Actions groupées" })).toBeNull()
    selectFirstTwo()
    expect(screen.getByRole("toolbar", { name: "Actions groupées" })).toBeTruthy()
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("2 médias sélectionnés")
  })

  it("glisser 2 médias sélectionnés sur un dossier : batch.move avec les 2 ids", async () => {
    render(<LibraryPage />)
    selectFirstTwo()
    fireEvent.dragStart(tile("m0"), { dataTransfer: dt() })
    const folder = screen.getByRole("treeitem", { name: /Direction/ })
    fireEvent.dragOver(folder, { dataTransfer: dt() })
    fireEvent.drop(folder, { dataTransfer: dt() })
    await waitFor(() => expect(batchCalls).toHaveLength(1))
    expect(batchCalls[0]).toEqual({ action: "move", folderId: "f1", ids: ["m0", "m1"] })
  })

  it("glisser une tuile hors sélection ne déplace que celle-ci", async () => {
    render(<LibraryPage />)
    selectFirstTwo()
    fireEvent.dragStart(tile("m3"), { dataTransfer: dt() })
    fireEvent.drop(screen.getByRole("treeitem", { name: /Sans dossier/ }), { dataTransfer: dt() })
    await waitFor(() => expect(batchCalls).toHaveLength(1))
    expect(batchCalls[0]).toEqual({ action: "move", folderId: null, ids: ["m3"] })
  })

  it("« Déplacer » de la barre ouvre le dialogue (alternative clavier) et déplace la sélection", async () => {
    render(<LibraryPage />)
    selectFirstTwo()
    fireEvent.click(screen.getByRole("button", { name: "Déplacer" }))
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "f2" } })
    fireEvent.click(screen.getAllByRole("button", { name: "Déplacer" }).at(-1)!)
    await waitFor(() => expect(batchCalls).toHaveLength(1))
    expect(batchCalls[0]).toEqual({ action: "move", folderId: "f2", ids: ["m0", "m1"] })
  })

  it("dossier glissé sur un autre dossier : PATCH parentId, toast avec Annuler", async () => {
    render(<LibraryPage />)
    fireEvent.dragStart(screen.getByRole("treeitem", { name: /Archives/ }), { dataTransfer: dt() })
    fireEvent.drop(screen.getByRole("treeitem", { name: /Direction/ }), { dataTransfer: dt() })
    await waitFor(() => expect(folderCalls).toHaveLength(1))
    expect(folderCalls[0]).toEqual({ url: "/api/media/folders/f2", body: { parentId: "f1" } })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect((toastSuccess.mock.calls[0][1] as { action: { label: string } }).action.label).toBe("Annuler")
  })

  it("Suppr ouvre le dialogue de mise à la corbeille", async () => {
    render(<LibraryPage />)
    selectFirstTwo()
    fireEvent.keyDown(document.body, { key: "Delete" })
    expect(await screen.findByRole("dialog")).toBeTruthy()
    expect(screen.getAllByText("Mettre à la corbeille").length).toBeGreaterThan(0)
  })

  it("Suppr sans sélection ne fait rien", () => {
    render(<LibraryPage />)
    fireEvent.keyDown(document.body, { key: "Delete" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("Ctrl+Z après un déplacement exécute l'annulation du dernier toast", async () => {
    render(<LibraryPage />)
    fireEvent.dragStart(tile("m2"), { dataTransfer: dt() })
    fireEvent.drop(screen.getByRole("treeitem", { name: /Direction/ }), { dataTransfer: dt() })
    await waitFor(() => expect(batchCalls).toHaveLength(1))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true })
    await waitFor(() => expect(batchCalls).toHaveLength(2))
    expect(batchCalls[1]).toEqual({ action: "move", folderId: null, ids: ["m2"] })
  })
})

vi.mock("./use-library-deeplink", () => ({ useLibraryDeeplink: () => {} }))
