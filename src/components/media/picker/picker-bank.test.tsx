// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PickerBank } from "./picker-bank"
import type { PickerSelection } from "./use-picker-selection"

vi.mock("next-intl", async () => (await import("../test-fixtures")).intlMock())
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const result = (id: string) => ({ id, thumb: `t-${id}`, regular: `r-${id}`, description: `Photo ${id}`, credit: "c" })
const picker: PickerSelection = {
  selected: [],
  toggle: vi.fn(),
  clear: vi.fn(),
  removeMany: vi.fn(),
  isSelected: () => false,
  atMax: false,
}
const imports = { busy: false, begin: () => new AbortController().signal, end: () => {} }

describe("PickerBank", () => {
  it("une recherche lente ne remplace pas les résultats d'une recherche plus récente", async () => {
    let resolveSlow: (v: unknown) => void = () => {}
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/image-providers"))
        return Promise.resolve({
          ok: true,
          json: async () => [{ name: "unsplash", displayName: "Unsplash", providerType: "stock", isEnabled: true }],
        })
      if (url.includes("q=chat"))
        return Promise.resolve({ ok: true, json: async () => ({ results: [result("recent")] }) })
      return new Promise((r) => (resolveSlow = r))
    })
    render(<PickerBank mode="single" spaceId="s1" picker={picker} imports={imports} onImported={() => {}} />)
    const input = await screen.findByRole("textbox")
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/images/search"))).toBe(true))
    fireEvent.change(input, { target: { value: "chat" } })
    fireEvent.submit(input.closest("form")!)
    await screen.findByRole("button", { name: /Photo recent/ })
    await act(async () => {
      resolveSlow({ ok: true, json: async () => ({ results: [result("ancien")] }) })
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(screen.getByRole("button", { name: /Photo recent/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Photo ancien/ })).toBeNull()
  })
})
