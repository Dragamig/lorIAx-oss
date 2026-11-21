// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import type { ReactNode } from "react"
import { useMediaList } from "./use-media-list"
import type { MediaFilters } from "@/lib/media/filters"

const filters: MediaFilters = { view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50 }

const item = (id: string) => ({ id, filename: `${id}.png` })
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe("useMediaList", () => {
  it("charge deux pages via loadMore, hasMore faux à nextCursor nul", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [item("a")], nextCursor: "c1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [item("b")], nextCursor: null }) })
    const { result } = renderHook(() => useMediaList(filters), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.hasMore).toBe(true)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.hasMore).toBe(false)
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=c1")
  })

  it("isError vrai quand l'API échoue", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) })
    const { result } = renderHook(() => useMediaList(filters), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.items).toEqual([])
  })

  it("échec de la page suivante : pas de boucle, hasMore faux, items conservés", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [item("a")], nextCursor: "c1" }) })
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) })
    const { result } = renderHook(() => useMediaList(filters), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.hasMore).toBe(false)
    const calls = fetchMock.mock.calls.length
    act(() => result.current.loadMore())
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
  it("mutate invalide aussi la liste d'une autre vue déjà consultée (Corbeille)", async () => {
    const trashFilters: MediaFilters = { ...filters, view: "trash" }
    let trashItems = [item("old")]
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({ items: url.includes("view=trash") ? trashItems : [item("a")], nextCursor: null }),
    }))
    const { result, rerender } = renderHook((f: MediaFilters) => useMediaList(f), {
      wrapper,
      initialProps: trashFilters,
    })
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual(["old"]))
    rerender(filters)
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual(["a"]))
    trashItems = [item("new"), item("old")]
    await act(async () => {
      await result.current.mutate()
    })
    const calls = fetchMock.mock.calls.length
    rerender(trashFilters)
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual(["new", "old"]))
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(calls + 2)
  })

  it("forced impose les types dans la requête, quels que soient les filtres", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [item("a")], nextCursor: null }) })
    const { result } = renderHook(() => useMediaList({ ...filters, kinds: ["video"] }, { kinds: ["image"] }), { wrapper })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain("kind=image")
    expect(url).not.toContain("kind=video")
  })
})


describe("useMediaList, déduplication SWR par défaut", () => {
  const dedupWrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
  )
  const trash: MediaFilters = { ...filters, view: "trash" }

  it("change de vue juste après une mutation : la corbeille est relue", async () => {
    let trashCount = 0
    fetchMock.mockImplementation(async (url: string) => {
      const isTrash = url.includes("view=trash")
      return { ok: true, json: async () => ({ items: isTrash && trashCount > 0 ? [item("t")] : [], nextCursor: null }) }
    })
    const { result, rerender } = renderHook(({ f }) => useMediaList(f), {
      wrapper: dedupWrapper,
      initialProps: { f: trash },
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(0)
    rerender({ f: filters })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // restauration : un média rejoint la corbeille, mutation, puis retour sur la corbeille en moins de 2 s
    trashCount = 1
    await act(async () => {
      await result.current.mutate()
    })
    rerender({ f: trash })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
  })
})
