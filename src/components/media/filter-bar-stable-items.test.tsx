// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import fr from "../../../messages/fr.json"
import { FilterBar } from "./filter-bar"
import type { MediaFilters } from "@/lib/media/filters"

vi.mock("next-intl", () => ({
  useLocale: () => "fr",
  useTranslations: (ns?: string) => (key: string) => {
    const full = ns ? `${ns}.${key}` : key
    return String(full.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], fr))
  },
}))

// Le Select réécrit `items` dans son store à chaque changement d'identité : un `items` recréé à
// chaque rendu relance une mise à jour en boucle (« Maximum update depth exceeded », sélecteur du bloc Fichier).
const seen: unknown[] = []
vi.mock("@/components/ui/select", () => ({
  Select: ({ items, children }: { items: unknown; children: React.ReactNode }) => {
    seen.push(items)
    return <div>{children}</div>
  },
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

afterEach(() => {
  cleanup()
  seen.length = 0
})

const filters = { view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50 } as MediaFilters

function props() {
  return {
    filters,
    setFilters: vi.fn(),
    reset: vi.fn(),
    hasActiveFilters: false,
    tags: [],
    folders: [],
    spaces: [{ id: "s1", name: "Direction" }],
    uploaders: [{ id: "u1", name: "Claire" }],
    totalLabel: "1 média",
  }
}

describe("FilterBar : items des Select", () => {
  it("garde la même référence `items` quand le contenu ne change pas entre deux rendus", () => {
    const { rerender } = render(<FilterBar {...props()} />)
    const first = new Set(seen)
    seen.length = 0
    // Nouveaux tableaux de même contenu, comme à chaque rendu d'un parent.
    rerender(<FilterBar {...props()} />)
    expect(seen.length).toBeGreaterThan(0)
    for (const items of seen) expect(first.has(items)).toBe(true)
  })

  it("renouvelle `items` quand le contenu change", () => {
    const { rerender } = render(<FilterBar {...props()} />)
    const first = new Set(seen)
    seen.length = 0
    rerender(<FilterBar {...props()} uploaders={[{ id: "u2", name: "Marc" }]} />)
    expect(seen.some((items) => !first.has(items))).toBe(true)
  })
})
