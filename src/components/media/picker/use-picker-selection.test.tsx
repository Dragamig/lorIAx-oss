// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { PickedMedia } from "./types"
import { usePickerSelection } from "./use-picker-selection"

const m = (id: string): PickedMedia => ({
  id,
  url: `/api/media/${id}`,
  filename: `${id}.png`,
  title: null,
  altText: null,
  mimeType: "image/png",
  kind: "image",
  sizeBytes: 1,
})

describe("usePickerSelection", () => {
  it("mode simple : un nouveau choix remplace le précédent", () => {
    const { result } = renderHook(() => usePickerSelection("single", 1))
    act(() => result.current.toggle(m("a")))
    act(() => result.current.toggle(m("b")))
    expect(result.current.selected.map((x) => x.id)).toEqual(["b"])
  })

  it("mode simple : deux bascules vident", () => {
    const { result } = renderHook(() => usePickerSelection("single", 1))
    act(() => result.current.toggle(m("b")))
    act(() => result.current.toggle(m("b")))
    expect(result.current.selected).toEqual([])
  })

  it("mode multiple : le plafond ignore le quatrième ajout", () => {
    const { result } = renderHook(() => usePickerSelection("multiple", 3))
    for (const id of ["a", "b", "c", "d"]) act(() => result.current.toggle(m(id)))
    expect(result.current.selected.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(result.current.atMax).toBe(true)
    expect(result.current.isSelected("a")).toBe(true)
    expect(result.current.isSelected("d")).toBe(false)
  })

  it("clear vide la sélection", () => {
    const { result } = renderHook(() => usePickerSelection("multiple", 3))
    act(() => result.current.toggle(m("a")))
    act(() => result.current.clear())
    expect(result.current.selected).toEqual([])
    expect(result.current.atMax).toBe(false)
  })
})
