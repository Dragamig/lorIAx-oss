// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { makeItems, mockLayout } from "./test-fixtures"

const h = vi.hoisted(() => ({ list: {} as Record<string, unknown>, mutate: vi.fn(), swrMutate: vi.fn() }))
const toastSuccess = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t1"))
const toastError = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t2"))

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("@/hooks/use-session", () => ({ useCurrentUser: () => ({ globalRole: "member" }) }))
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
      if (url.endsWith("/text") || url.includes("/text?")) return json({ status: "unsupported" })
      if (url === "/api/media/m0/usages") return json({ entries: [], hiddenCount: 0 })
      if (url === "/api/media/m0/meta") return json({ media: { ...((h.list.items as object[])[0]), description: null, checksumSha256: null, pageCount: null, origin: "upload", documentId: null, deletedBy: null, publicShared: false, canChangeSpace: true, canErase: false } })
      return json({})
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("LibraryPage : aperçu", () => {
  it("double-clic sur une tuile ouvre l'aperçu, flèche droite passe au média suivant", async () => {
    render(<LibraryPage />)
    fireEvent.doubleClick(tile("m0"))
    expect(await screen.findByText("1 sur 4")).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" })
    expect(screen.getByText("2 sur 4")).toBeTruthy()
  })

  it("bouton Aperçu du panneau ouvre l'aperçu du média ouvert", async () => {
    render(<LibraryPage />)
    fireEvent.click(tile("m0"))
    fireEvent.click(await screen.findByLabelText("Aperçu"))
    expect(await screen.findByText("1 sur 4")).toBeTruthy()
    expect(await screen.findByLabelText("Changer d'espace")).toBeTruthy()
  })

  it("l'aperçu suit l'id ouvert : il se ferme si le média quitte la liste", async () => {
    const { rerender } = render(<LibraryPage />)
    fireEvent.doubleClick(tile("m1"))
    expect(await screen.findByText("2 sur 4")).toBeTruthy()
    h.list = { ...h.list, items: (h.list.items as { id: string }[]).filter((x) => x.id !== "m0") }
    rerender(<LibraryPage />)
    expect(await screen.findByText("1 sur 3")).toBeTruthy()
    h.list = { ...h.list, items: (h.list.items as { id: string }[]).filter((x) => x.id !== "m1") }
    rerender(<LibraryPage />)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

vi.mock("./use-library-deeplink", () => ({ useLibraryDeeplink: () => {} }))
