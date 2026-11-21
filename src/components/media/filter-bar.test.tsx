// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import fr from "../../../messages/fr.json"
import { FilterBar } from "./filter-bar"
import type { MediaFilters } from "@/lib/media/filters"

vi.mock("next-intl", () => ({
  useLocale: () => "fr",
  useTranslations: (ns?: string) => (key: string, vars?: Record<string, string>) => {
    const full = ns ? `${ns}.${key}` : key
    const raw = full.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], fr)
    return String(raw).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? "")
  },
}))

afterEach(cleanup)

const baseFilters = { view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50 } as MediaFilters
const folders = [
  { id: "f1", parentId: null, name: "A", mediaCount: 1 },
  { id: "f2", parentId: "f1", name: "B", mediaCount: 1 },
]

function setup(over: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  const props = {
    filters: baseFilters,
    setFilters: vi.fn(),
    reset: vi.fn(),
    hasActiveFilters: false,
    tags: [{ id: "t1", label: "Logo", count: 3 }],
    folders,
    spaces: [{ id: "s1", name: "Direction" }],
    uploaders: [{ id: "u1", name: "Claire" }],
    totalLabel: "12 médias",
    layout: "grid" as const,
    onLayoutChange: vi.fn(),
    ...over,
  }
  render(<FilterBar {...props} />)
  return props
}

describe("FilterBar", () => {
  it("choisir PDF appelle setFilters avec kinds pdf et liste 7 types distincts", () => {
    const p = setup()
    fireEvent.click(screen.getByRole("button", { name: /^Type/ }))
    const boxes = screen.getAllByRole("checkbox")
    expect(boxes).toHaveLength(7)
    const labels = boxes.map((b) => b.closest("label")?.textContent)
    expect(new Set(labels).size).toBe(7)
    fireEvent.click(screen.getByRole("checkbox", { name: "PDF" }))
    expect(p.setFilters).toHaveBeenCalledWith({ kinds: ["pdf"] })
  })

  it("période inversée : message et aucun appel", async () => {
    const p = setup({ filters: { ...baseFilters, to: "2026-01-10" } })
    fireEvent.click(screen.getByRole("button", { name: /^Du/ }))
    fireEvent.change(await screen.findByLabelText("Du"), { target: { value: "2026-02-01" } })
    expect(screen.getByText(fr.library.filters.periodInvalid)).toBeTruthy()
    expect(p.setFilters).not.toHaveBeenCalled()
  })

  it("Échap ferme le menu Tags et rend le focus au bouton", async () => {
    setup()
    const btn = screen.getByRole("button", { name: /^Tags/ })
    btn.focus()
    fireEvent.click(btn)
    const box = await screen.findByRole("checkbox", { name: /^Logo/ })
    fireEvent.keyDown(box, { key: "Escape" })
    await vi.waitFor(() => expect(screen.queryByRole("checkbox", { name: /^Logo/ })).toBeNull())
    expect(document.activeElement).toBe(btn)
  })

  it("Réinitialiser est désactivé et expliqué à filtres vides", () => {
    setup()
    const btn = screen.getByRole("button", { name: fr.library.actions.resetFilters }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe(fr.library.filters.resetDisabled)
  })

  it("Réinitialiser appelle reset quand des filtres sont actifs", () => {
    const p = setup({ hasActiveFilters: true })
    fireEvent.click(screen.getByRole("button", { name: fr.library.actions.resetFilters }))
    expect(p.reset).toHaveBeenCalled()
  })

  it("fil d'Ariane A > B : lien racine Médiathèque puis deux liens", () => {
    const p = setup({ filters: { ...baseFilters, folderId: "f2" } })
    const nav = screen.getByRole("navigation", { name: fr.library.filters.breadcrumb })
    const links = within(nav).getAllByRole("link")
    expect(links.map((l) => l.textContent)).toEqual([fr.library.page.title, "A", "B"])
    expect(links[2].getAttribute("aria-current")).toBe("page")
    fireEvent.click(links[0])
    expect(p.setFilters).toHaveBeenCalledWith({ folderId: undefined })
  })

  it("le bouton de tri porte aria-sort cohérent et inverse le sens", () => {
    const p = setup({ filters: { ...baseFilters, sort: "filename", dir: "asc" } })
    const btn = screen.getByRole("button", { name: fr.library.sort.toggleDir })
    expect(btn.getAttribute("aria-sort")).toBe("ascending")
    fireEvent.click(btn)
    expect(p.setFilters).toHaveBeenCalledWith({ dir: "desc" })
  })

  it("Non utilisés bascule la vue", () => {
    const p = setup()
    fireEvent.click(screen.getByRole("button", { name: fr.library.filters.unused }))
    expect(p.setFilters).toHaveBeenCalledWith({ view: "unused" })
  })

  it("lockedKinds absent : le compteur et la bascule de vue sont rendus", () => {
    const p = setup()
    expect(screen.getByText("12 médias")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: fr.library.actions.toggleView }))
    expect(p.onLayoutChange).toHaveBeenCalledWith("list")
  })

  it("le champ de recherche suit q de l'URL (réinitialisation, retour arrière)", () => {
    const p = setup({ filters: { ...baseFilters, q: "logo" } })
    const input = screen.getByRole("searchbox") as HTMLInputElement
    expect(input.value).toBe("logo")
    cleanup()
    // Même instance, filtres réinitialisés : on re-rend avec le même composant monté.
    const props = { ...p, filters: { ...baseFilters, q: "logo" } }
    const ui = render(<FilterBar {...props} />)
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("logo")
    ui.rerender(<FilterBar {...props} filters={baseFilters} />)
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("")
  })

  it("les champs de taille suivent les filtres", () => {
    const MB = 1024 * 1024
    const p = setup({ filters: { ...baseFilters, minSize: 2 * MB } })
    const props = { ...p, filters: { ...baseFilters, minSize: 2 * MB } }
    cleanup()
    const ui = render(<FilterBar {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /Taille minimale|Min/i }))
    expect((screen.getByLabelText(fr.library.filters.minSize) as HTMLInputElement).value).toBe("2")
    ui.rerender(<FilterBar {...props} filters={baseFilters} />)
    expect((screen.getByLabelText(fr.library.filters.minSize) as HTMLInputElement).value).toBe("")
  })
})
