// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import fr from "../../../messages/fr.json"
import { FolderTree } from "./folder-tree"
import { QuotaGauge } from "./quota-gauge"
import type { MediaFilters } from "@/lib/media/filters"
import type { LibraryStats } from "@/lib/media/list"

vi.mock("next-intl", () => ({
  useLocale: () => "fr",
  useTranslations: (ns?: string) => (key: string, vars?: Record<string, string>) => {
    const full = ns ? `${ns}.${key}` : key
    const raw = full.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], fr)
    return String(raw).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? "")
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(cleanup)

const stats: LibraryStats = {
  total: 40,
  unused: 5,
  mine: 7,
  trash: 2,
  orphan: 0,
  noFolder: 11,
  byFolder: {},
  byTag: [{ id: "tag1", label: "Logo", count: 3 }],
  usedBytes: 83 * 1024 * 1024,
  limitBytes: 100 * 1024 * 1024,
  percent: 83,
}
const folders = [
  { id: "f1", parentId: null, name: "Direction", mediaCount: 4 },
  { id: "f2", parentId: "f1", name: "Contrats", mediaCount: 1 },
]
const baseFilters = { view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50 } as MediaFilters

function setup(over: Partial<React.ComponentProps<typeof FolderTree>> = {}) {
  const props = {
    folders,
    stats,
    filters: baseFilters,
    onNavigate: vi.fn(),
    onDropMedia: vi.fn(),
    onFolderMutated: vi.fn(),
    ...over,
  }
  render(<FolderTree {...props} />)
  return props
}

describe("FolderTree", () => {
  it("un seul arrêt de tabulation et la flèche bas déplace le focus", () => {
    setup()
    const items = screen.getAllByRole("treeitem")
    expect(items.filter((i) => i.tabIndex === 0)).toHaveLength(1)
    items[0].focus()
    fireEvent.keyDown(items[0], { key: "ArrowDown" })
    expect(document.activeElement).toBe(items[1])
    expect(screen.getAllByRole("treeitem").filter((i) => i.tabIndex === 0)).toHaveLength(1)
  })

  it("flèche droite déplie, gauche replie", () => {
    setup()
    expect(screen.queryByText("Contrats")).toBeNull()
    const dir = screen.getByText("Direction").closest("[role=treeitem]") as HTMLElement
    dir.focus()
    fireEvent.keyDown(dir, { key: "ArrowRight" })
    expect(screen.getByText("Contrats")).toBeTruthy()
    fireEvent.keyDown(dir, { key: "ArrowLeft" })
    expect(screen.queryByText("Contrats")).toBeNull()
  })

  it("« Non utilisés » active le filtre view=unused", () => {
    const p = setup()
    fireEvent.click(screen.getByText("Non utilisés"))
    expect(p.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ view: "unused" }))
  })

  it("« Hors espace » : réservé aux admins ET à la présence d'orphelins", () => {
    setup()
    expect(screen.queryByText("Hors espace")).toBeNull()
    cleanup()
    setup({ isAdmin: true })
    expect(screen.queryByText("Hors espace")).toBeNull()
    cleanup()
    setup({ stats: { ...stats, orphan: 3 } })
    expect(screen.queryByText("Hors espace")).toBeNull()
    cleanup()
    setup({ isAdmin: true, stats: { ...stats, orphan: 3 } })
    expect(screen.getByText("Hors espace")).toBeTruthy()
  })

  it("affiche le compteur de « Sans dossier »", () => {
    setup()
    const row = screen.getByText("Sans dossier").closest("[role=treeitem]") as HTMLElement
    expect(row.textContent).toContain("11")
  })

  it("info-bulle du tag et bascule du filtre", () => {
    const p = setup()
    const tag = screen.getByTitle("Filtrer par le tag Logo")
    fireEvent.click(tag)
    expect(p.onNavigate).toHaveBeenCalledWith({ tagIds: ["tag1"] })
    cleanup()
    setup({ filters: { ...baseFilters, tagIds: ["tag1"] } })
    expect(screen.getByTitle("Retirer le filtre Logo")).toBeTruthy()
  })

  it("dépôt d'un média sur un dossier et sur « Sans dossier »", () => {
    const p = setup()
    const dir = screen.getByText("Direction").closest("[role=treeitem]") as HTMLElement
    fireEvent.drop(dir)
    expect(p.onDropMedia).toHaveBeenCalledWith("f1")
    fireEvent.drop(screen.getByText("Sans dossier").closest("[role=treeitem]") as HTMLElement)
    expect(p.onDropMedia).toHaveBeenCalledWith(null)
  })

  it("boutons de dossier désactivés avec raison pour un lecteur", () => {
    setup({ canWrite: false })
    const b = screen.getByRole("button", { name: "Nouveau dossier" }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    fireEvent.mouseEnter(b)
    expect(screen.getByRole("tooltip").textContent).toBe("Modification des dossiers réservée aux éditeurs")
  })

  it("renommer/déplacer/supprimer demandent de sélectionner un dossier", () => {
    setup()
    expect((screen.getByRole("button", { name: "Renommer le dossier" }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("QuotaGauge", () => {
  it("83 % donne aria-valuenow 83", () => {
    render(<QuotaGauge stats={stats} />)
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("83")
    expect(screen.getByText("Versions et corbeille comptent")).toBeTruthy()
  })
  it("limite nulle : Illimité, pas de barre", () => {
    render(<QuotaGauge stats={{ usedBytes: 1024, limitBytes: null, percent: null }} />)
    expect(screen.getByText(/Illimité/)).toBeTruthy()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })
})
