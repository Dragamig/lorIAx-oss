// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { makeItems, mockLayout } from "./test-fixtures"

const h = vi.hoisted(() => ({ list: {} as Record<string, unknown>, mutate: vi.fn(), swrMutate: vi.fn() }))
const toastSuccess = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t1"))
const toastError = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t2"))

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: vi.fn() } }))
vi.mock("./use-library-filters", () => ({
  useLibraryFilters: () => ({
    filters: { view: "trash", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50 },
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

beforeEach(() => {
  mockLayout()
  batchCalls = []
  folderCalls = []
  toastSuccess.mockClear()
  toastError.mockClear()
  h.mutate.mockReset()
  h.list = { items: makeItems(4).map((m) => ({ ...m, deletedAt: "2026-11-01T00:00:00.000Z", purgeAt: "2099-01-01T00:00:00.000Z", affectedCount: 0 })), isLoading: false, isError: false, isValidating: false, hasMore: false, loadMore: vi.fn(), mutate: h.mutate }
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

const row = (id: string) => document.querySelector<HTMLElement>(`[data-media-row][data-media-id="${id}"]`)!

describe("LibraryPage, vue Corbeille", () => {
  it("affiche la vue Corbeille et restaure la sélection groupée, sans actions de rangement", async () => {
    render(<LibraryPage />)
    expect(screen.getByRole("grid", { name: "Corbeille" })).toBeTruthy()
    fireEvent.click(within(row("m0")).getByRole("checkbox"))
    fireEvent.click(within(row("m1")).getByRole("checkbox"))
    expect(screen.queryByRole("button", { name: "Déplacer" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Mettre à la corbeille" })).toBeNull()
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Actions groupées" })).getByRole("button", { name: "Restaurer" }))
    await waitFor(() => expect(batchCalls).toHaveLength(1))
    expect(batchCalls[0]).toEqual({ action: "restore", ids: ["m0", "m1"] })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toBe("2 médias restaurés")
  })

  it("Suppr n'ouvre pas la mise à la corbeille", () => {
    render(<LibraryPage />)
    fireEvent.click(within(row("m0")).getByRole("checkbox"))
    fireEvent.keyDown(document.body, { key: "Delete" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

vi.mock("./use-library-deeplink", () => ({ useLibraryDeeplink: () => {} }))
