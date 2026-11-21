// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ qs: "", replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(h.qs) }))
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ replace: h.replace }),
  usePathname: () => "/mediatheque",
}))

import { useLibraryDeeplink } from "./use-library-deeplink"

const base = () => ({
  ids: undefined as string[] | undefined,
  items: [] as { id: string }[],
  canUpload: true,
  onUpload: vi.fn(),
  onOpen: vi.fn(),
})

beforeEach(() => {
  h.qs = ""
  h.replace.mockReset()
})

describe("useLibraryDeeplink", () => {
  it("?upload=1 ouvre le dialogue puis retire le paramètre", () => {
    h.qs = "upload=1"
    const o = base()
    renderHook(() => useLibraryDeeplink(o))
    expect(o.onUpload).toHaveBeenCalledTimes(1)
    expect(h.replace).toHaveBeenCalledWith("/mediatheque")
  })

  it("quota plein : n'ouvre pas le dialogue mais retire le paramètre", () => {
    h.qs = "upload=1"
    const o = { ...base(), canUpload: false }
    renderHook(() => useLibraryDeeplink(o))
    expect(o.onUpload).not.toHaveBeenCalled()
    expect(h.replace).toHaveBeenCalled()
  })

  it("sans paramètre : rien", () => {
    const o = base()
    renderHook(() => useLibraryDeeplink(o))
    expect(o.onUpload).not.toHaveBeenCalled()
    expect(h.replace).not.toHaveBeenCalled()
  })

  it("?id : ouvre le média quand la liste le contient, une seule fois", () => {
    const o = { ...base(), ids: ["m1"] }
    const { rerender } = renderHook((p) => useLibraryDeeplink(p), { initialProps: o })
    expect(o.onOpen).not.toHaveBeenCalled()
    const loaded = { ...o, items: [{ id: "m1" }] }
    rerender(loaded)
    rerender({ ...loaded, items: [{ id: "m1" }] })
    expect(o.onOpen).toHaveBeenCalledTimes(1)
    expect(o.onOpen).toHaveBeenCalledWith("m1")
  })
})
