// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useSelection } from "./use-selection"

const ids = ["a", "b", "c", "d", "e"]

describe("useSelection", () => {
  it("bascule un id et fixe l'ancre", () => {
    const { result } = renderHook(() => useSelection(ids))
    act(() => result.current.toggle("b"))
    expect(result.current.isSelected("b")).toBe(true)
    expect(result.current.anchorId).toBe("b")
    act(() => result.current.toggle("b"))
    expect(result.current.isSelected("b")).toBe(false)
  })

  it("sélectionne la plage de a à d", () => {
    const { result } = renderHook(() => useSelection(ids))
    act(() => result.current.toggle("a"))
    act(() => result.current.range("d"))
    expect([...result.current.selected].sort()).toEqual(["a", "b", "c", "d"])
  })

  it("all() sélectionne les ids chargés, clear() vide", () => {
    const { result } = renderHook(() => useSelection(ids))
    act(() => result.current.all())
    expect(result.current.selected.size).toBe(5)
    act(() => result.current.clear())
    expect(result.current.selected.size).toBe(0)
  })

  it("survit au chargement de la suite et saute les ids disparus", () => {
    const { result, rerender } = renderHook(({ list }) => useSelection(list), { initialProps: { list: ids } })
    act(() => result.current.toggle("b"))
    act(() => result.current.toggle("c"))
    rerender({ list: [...ids, "f"] })
    expect(result.current.selected.size).toBe(2)
    rerender({ list: ["a", "c", "d"] })
    expect([...result.current.selected]).toEqual(["c"])
  })

  it("range : ancre disparue de la liste, la cible devient l'ancre", () => {
    const { result, rerender } = renderHook(({ list }) => useSelection(list), { initialProps: { list: ids } })
    act(() => result.current.toggle("b"))
    rerender({ list: ["a", "c", "d"] })
    act(() => result.current.range("d"))
    expect(result.current.anchorId).toBe("d")
    expect([...result.current.selected]).toEqual(["d"])
  })

  it("changement de liste puis retour : rien n'est resélectionné", () => {
    const { result, rerender } = renderHook(({ list }) => useSelection(list), { initialProps: { list: ids } })
    act(() => result.current.toggle("b"))
    rerender({ list: ["x", "y"] })
    expect(result.current.selected.size).toBe(0)
    rerender({ list: ids })
    expect(result.current.selected.size).toBe(0)
    expect(result.current.anchorId).toBeNull()
  })
})
