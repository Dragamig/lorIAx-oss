// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { makeItems, mockLayout } from "./test-fixtures"

const h = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  filters: {} as Record<string, unknown>,
  setFilters: vi.fn(),
  mutate: vi.fn(),
  add: vi.fn(),
  swrMutate: vi.fn(),
  onMutated: [] as unknown[],
}))

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("./use-library-filters", () => ({
  useLibraryFilters: () => ({ filters: h.filters, reset: vi.fn(), hasActiveFilters: false, setFilters: h.setFilters }),
}))
vi.mock("./use-media-list", () => ({ useMediaList: () => ({ ...h.list }) }))
vi.mock("./upload-tray", () => ({
  UploadTray: ({ onMutated }: { onMutated: unknown }) => {
    h.onMutated.push(onMutated)
    return null
  },
}))
vi.mock("swr", () => ({
  default: (key: string) => {
    const data: Record<string, unknown> = {
      "/api/media/stats": { total: 2, unused: 0, mine: 0, trash: 0, orphan: 0, noFolder: 2, byFolder: {}, byTag: [], usedBytes: 1, limitBytes: 100, percent: 1 },
      "/api/media/folders": { folders: [{ id: "f1", parentId: null, name: "Direction", mediaCount: 0 }] },
      "/api/spaces": [{ id: "s1", name: "Espace A" }],
    }
    return { data: data[key], mutate: h.swrMutate, error: undefined }
  },
}))
vi.mock("./use-upload-queue", () => ({
  useUploadQueue: () => ({
    add: h.add,
    cancel: vi.fn(),
    retry: vi.fn(),
    resolveDuplicate: vi.fn(),
    clearFinished: vi.fn(),
    subscribe: () => () => {},
    snapshot: () => [],
  }),
  useQueueSnapshot: () => [],
  useBatchToast: () => {},
}))

import { LibraryPage } from "./library-page"

const base = { isLoading: false, isError: false, isValidating: false, hasMore: false, loadMore: vi.fn() }

beforeEach(() => {
  mockLayout()
  h.add.mockReset()
  h.onMutated = []
  h.setFilters.mockReset()
  h.mutate.mockReset()
  h.filters = { view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50, spaceId: "s1", folderId: "f1" }
  h.list = { ...base, items: makeItems(3), mutate: h.mutate }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("LibraryPage", () => {
  it("chargement puis grille", () => {
    h.list = { ...base, items: [], isLoading: true, mutate: h.mutate }
    const { rerender } = render(<LibraryPage />)
    expect(screen.getAllByRole("status", { name: "Chargement des médias" }).length).toBeGreaterThan(0)
    h.list = { ...base, items: makeItems(3), mutate: h.mutate }
    rerender(<LibraryPage />)
    expect(screen.getByRole("listbox", { name: "Médias" })).toBeTruthy()
    expect(screen.getAllByRole("option")).toHaveLength(3)
  })

  it("« Téléverser » ouvre le dialogue", () => {
    render(<LibraryPage />)
    fireEvent.click(screen.getByRole("button", { name: /Téléverser/ }))
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByText("Téléverser des médias")).toBeTruthy()
  })

  it("dépôt sur la zone centrale : dialogue, puis queue.add avec le dossier courant", async () => {
    render(<LibraryPage />)
    const file = new File(["a"], "a.png", { type: "image/png" })
    fireEvent.drop(screen.getByTestId("library-center"), { dataTransfer: { types: ["Files"], files: [file] } })
    expect(screen.getByRole("dialog")).toBeTruthy()
    const start = await screen.findByRole("button", { name: "Téléverser" })
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(start)
    expect(h.add).toHaveBeenCalledWith([file], { spaceId: "s1", folderId: "f1", tags: [] })
  })

  it("état d'erreur avec « Réessayer » (une seule source : la vue)", () => {
    h.list = { ...base, items: [], isError: true, mutate: h.mutate }
    render(<LibraryPage />)
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(h.mutate).toHaveBeenCalled()
  })

  it("bascule en liste : colonnes triables, tri par en-tête", () => {
    render(<LibraryPage />)
    fireEvent.click(screen.getByRole("button", { name: /Basculer grille et liste/ }))
    const header = screen.getByRole("columnheader", { name: /Taille/ })
    fireEvent.click(within(header).getByRole("button"))
    expect(h.setFilters).toHaveBeenCalledWith({ sort: "sizeBytes", dir: "desc" })
  })

  it("refreshAll reste stable d'un rendu à l'autre, et rafraîchit liste, stats et dossiers", () => {
    const { rerender } = render(<LibraryPage />)
    rerender(<LibraryPage />)
    rerender(<LibraryPage />)
    const refs = h.onMutated
    expect(refs.length).toBeGreaterThan(2)
    expect(new Set(refs).size).toBe(1)
    h.mutate.mockClear()
    h.swrMutate.mockClear()
    ;(refs[0] as () => void)()
    expect(h.mutate).toHaveBeenCalledTimes(1)
    expect(h.swrMutate).toHaveBeenCalledTimes(2)
  })
})

vi.mock("./use-library-deeplink", () => ({ useLibraryDeeplink: () => {} }))
