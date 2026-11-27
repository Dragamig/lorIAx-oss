// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"

const replace = vi.fn()
let search = ""

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/mediatheque",
}))

import { useLibraryFilters } from "./use-library-filters"

const TAG = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  replace.mockReset()
  search = ""
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe("useLibraryFilters", () => {
  it("lit les filtres depuis l'URL", () => {
    search = `kind=image&kind=pdf&tagId=${TAG}`
    const { result } = renderHook(() => useLibraryFilters())
    expect(result.current.filters.kinds).toEqual(["image", "pdf"])
    expect(result.current.filters.tagIds).toEqual([TAG])
    expect(result.current.hasActiveFilters).toBe(true)
  })

  it("setFilters écrit par router.replace", () => {
    const { result } = renderHook(() => useLibraryFilters())
    act(() => result.current.setFilters({ kinds: ["pdf"] }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith("/mediatheque?kind=pdf")
  })

  it("reset vide la chaîne de requête", () => {
    search = "kind=pdf"
    const { result } = renderHook(() => useLibraryFilters())
    act(() => result.current.reset())
    expect(replace).toHaveBeenCalledWith("/mediatheque")
  })

  it("ignore un paramètre invalide et garde le défaut", () => {
    search = "kind=exe"
    const { result } = renderHook(() => useLibraryFilters())
    expect(result.current.filters.kinds).toEqual([])
    expect(result.current.hasActiveFilters).toBe(false)
  })

  it("ignore seulement le paramètre invalide", () => {
    search = "kind=exe&kind=pdf&sort=bogus&dir=asc"
    const { result } = renderHook(() => useLibraryFilters())
    expect(result.current.filters.dir).toBe("asc")
    expect(result.current.filters.sort).toBe("createdAt")
  })

  it("une période inversée retombe sur le défaut", () => {
    search = "from=2026-02-01&to=2026-01-01"
    const { result } = renderHook(() => useLibraryFilters())
    expect(result.current.filters.from).toBeUndefined()
    expect(result.current.filters.to).toBeUndefined()
  })

  it("q saisi 5 fois en 100 ms n'appelle replace qu'une fois", () => {
    const { result } = renderHook(() => useLibraryFilters())
    for (const q of ["a", "ab", "abc", "abcd", "abcde"]) {
      act(() => result.current.setFilters({ q }))
      act(() => {
        vi.advanceTimersByTime(20)
      })
    }
    expect(replace).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith("/mediatheque?q=abcde")
  })

  it("deux setFilters rapprochés (sans rendu entre) ne perdent aucun patch", () => {
    const { result } = renderHook(() => useLibraryFilters())
    act(() => {
      result.current.setFilters({ kinds: ["pdf"] })
      result.current.setFilters({ sort: "filename" })
    })
    expect(replace).toHaveBeenCalledTimes(2)
    const last = String(replace.mock.calls[1][0])
    expect(last).toContain("kind=pdf")
    expect(last).toContain("sort=filename")
  })

  it("applyQuery remplace les filtres par ceux de la vue et écrit l'URL", () => {
    search = "kind=pdf&q=ancien"
    const { result } = renderHook(() => useLibraryFilters())
    act(() => result.current.applyQuery("kind=image&sort=filename"))
    expect(replace).toHaveBeenCalledWith("/mediatheque?kind=image&sort=filename")
  })

  it("applyQuery tolère un paramètre périmé", () => {
    const { result } = renderHook(() => useLibraryFilters())
    act(() => result.current.applyQuery("kind=image&sort=nimportequoi&cursor=zzz"))
    expect(replace).toHaveBeenCalledWith("/mediatheque?kind=image")
  })
})
