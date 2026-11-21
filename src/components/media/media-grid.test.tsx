// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { MediaGrid } from "./media-grid"
import { TILE_SIZE } from "./media-tile"
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

function setup(items = makeItems(5), over: Partial<React.ComponentProps<typeof MediaGrid>> = {}) {
  const onOpen = vi.fn()
  const { result } = renderHook(() => useSelection(items.map((i) => i.id)))
  const props = {
    items,
    selection: result.current,
    currentId: null as string | null,
    onOpen,
    hasMore: false,
    loadMore: vi.fn(),
    isValidating: false,
    ...over,
  }
  const ui = render(<MediaGrid {...props} />)
  return { ...ui, onOpen, props }
}

describe("MediaGrid", () => {
  it("ne rend qu'une fenêtre de 200 éléments", () => {
    setup(makeItems(200))
    const n = document.querySelectorAll("[data-media-tile]").length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(60)
  })

  it("toutes les tuiles ont les mêmes dimensions, même avec un nom de 300 caractères", () => {
    setup(makeItems(4, (i) => (i === 1 ? "x".repeat(300) : `a${i}.png`)))
    const tiles = [...document.querySelectorAll<HTMLElement>("[data-media-tile]")]
    expect(tiles).toHaveLength(4)
    for (const t of tiles) {
      expect(t.style.width).toBe(`${TILE_SIZE.width}px`)
      expect(t.style.height).toBe(`${TILE_SIZE.height}px`)
    }
  })

  it("tronque le nom et porte le nom entier en info-bulle", () => {
    const long = "y".repeat(300)
    setup(makeItems(1, () => long))
    const tile = document.querySelector<HTMLElement>("[data-media-tile]")!
    expect(tile.querySelector(".truncate")).not.toBeNull()
    expect(tile.getAttribute("title")).toContain(long)
  })

  it("Entrée ouvre, Espace coche sans changer aria-current", () => {
    const { onOpen, props } = setup()
    const first = document.querySelector<HTMLElement>("[data-media-tile]")!
    first.focus()
    fireEvent.keyDown(first, { key: "Enter" })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "m0" }))
    const toggle = vi.spyOn(props.selection, "toggle")
    fireEvent.keyDown(first, { key: " " })
    expect(toggle).toHaveBeenCalledWith("m0")
    expect(document.querySelector("[aria-current]")).toBeNull()
  })

  it("les flèches déplacent le focus", () => {
    setup()
    const grid = screen.getByRole("listbox")
    const first = document.querySelector<HTMLElement>("[data-media-tile]")!
    first.focus()
    fireEvent.keyDown(grid, { key: "ArrowRight" })
    expect(document.activeElement?.getAttribute("data-media-id")).toBe("m1")
  })

  it("marque le média ouvert avec aria-current", () => {
    setup(makeItems(3), { currentId: "m1" })
    expect(document.querySelector("[aria-current='true']")?.getAttribute("data-media-id")).toBe("m1")
  })

  it("affiche l'état vide avec Réinitialiser seulement si des filtres sont actifs", () => {
    const onResetFilters = vi.fn()
    const { rerender, props } = setup([], { hasActiveFilters: true, onResetFilters })
    fireEvent.click(screen.getByText("Réinitialiser les filtres"))
    expect(onResetFilters).toHaveBeenCalled()
    rerender(<MediaGrid {...props} hasActiveFilters={false} onResetFilters={onResetFilters} />)
    expect(screen.queryByText("Réinitialiser les filtres")).toBeNull()
  })

  it("affiche l'état d'erreur avec Réessayer", () => {
    const onRetry = vi.fn()
    setup([], { isError: true, onRetry })
    fireEvent.click(screen.getByText("Réessayer"))
    expect(onRetry).toHaveBeenCalled()
  })

  it("erreur de page suivante : la grille reste, avec un bouton de nouvel essai", () => {
    const onRetry = vi.fn()
    setup(makeItems(3), { isError: true, onRetry })
    expect(document.querySelectorAll("[data-media-tile]").length).toBe(3)
    fireEvent.click(screen.getByText("Réessayer"))
    expect(onRetry).toHaveBeenCalled()
  })
})
