// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { MediaList } from "./media-list"
import { useSelection } from "./use-selection"
import { intlMock, makeItems, mockLayout } from "./test-fixtures"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("./library-page", async () => {
  const React = await import("react")
  return {
    LibraryErrorState: ({ onRetry }: { onRetry: () => void }) =>
      React.createElement("button", { onClick: onRetry }, "Réessayer"),
  }
})

beforeEach(() => mockLayout())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(items = makeItems(5), over: Partial<React.ComponentProps<typeof MediaList>> = {}) {
  const onSort = vi.fn()
  const onOpen = vi.fn()
  const { result } = renderHook(() => useSelection(items.map((i) => i.id)))
  const props = {
    items,
    selection: result.current,
    currentId: null as string | null,
    onOpen,
    sort: "createdAt" as const,
    dir: "desc" as const,
    onSort,
    hasMore: false,
    loadMore: vi.fn(),
    isValidating: false,
    ...over,
  }
  render(<MediaList {...props} />)
  return { onSort, onOpen, props }
}

describe("MediaList", () => {
  it("un clic sur l'en-tête Taille appelle onSort('sizeBytes')", () => {
    const { onSort } = setup()
    fireEvent.click(screen.getByRole("button", { name: /Taille/ }))
    expect(onSort).toHaveBeenCalledWith("sizeBytes")
  })

  it("expose aria-sort sur la colonne triée", () => {
    setup()
    expect(document.querySelector("[aria-sort='descending']")).not.toBeNull()
  })

  it("virtualise les lignes", () => {
    setup(makeItems(200))
    const n = document.querySelectorAll("[data-media-row]").length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(60)
  })

  it("Entrée ouvre, flèche bas déplace le focus", () => {
    const { onOpen } = setup()
    const list = screen.getByRole("grid")
    const first = document.querySelector<HTMLElement>("[data-media-row]")!
    first.focus()
    fireEvent.keyDown(list, { key: "ArrowDown" })
    expect(document.activeElement?.getAttribute("data-media-id")).toBe("m1")
    fireEvent.keyDown(document.activeElement!, { key: "Enter" })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }))
  })

  it("état vide sans bouton Réinitialiser quand aucun filtre", () => {
    setup([], { hasActiveFilters: false })
    expect(screen.queryByText("Réinitialiser les filtres")).toBeNull()
    expect(screen.getByText("Aucun média")).toBeTruthy()
  })

  it("rôles ARIA de grille : grid, row, columnheader, gridcell, sans listbox", () => {
    setup()
    expect(screen.getByRole("grid")).toBeTruthy()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0)
    const row = document.querySelector<HTMLElement>("[data-media-row]")!
    expect(row.getAttribute("role")).toBe("row")
    expect(row.querySelectorAll("[role='gridcell']").length).toBeGreaterThan(0)
  })

  it("une case à cocher par ligne coche sans ouvrir", () => {
    const { onOpen, props } = setup()
    const toggle = vi.spyOn(props.selection, "toggle")
    fireEvent.click(screen.getAllByRole("checkbox")[0])
    expect(toggle).toHaveBeenCalledWith("m0")
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("erreur de page suivante : la liste reste, avec un bouton de nouvel essai", () => {
    const onRetry = vi.fn()
    setup(makeItems(3), { isError: true, onRetry })
    expect(document.querySelectorAll("[data-media-row]").length).toBe(3)
    fireEvent.click(screen.getByText("Réessayer"))
    expect(onRetry).toHaveBeenCalled()
  })
})
