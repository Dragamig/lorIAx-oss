// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { useSelection } from "./use-selection"
import { makeItems, mockLayout } from "./test-fixtures"
import type { MediaListItem } from "@/lib/media/list"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())

import { TrashView } from "./trash-view"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 15)

function trashed(n: number): MediaListItem[] {
  return makeItems(n).map((m, i) => ({
    ...m,
    deletedAt: new Date(NOW - 25 * DAY).toISOString(),
    purgeAt: new Date(NOW + (5 - i) * DAY).toISOString(),
    affectedCount: i,
  }))
}

type Over = Partial<React.ComponentProps<typeof TrashView>>
function Harness({ items, over = {} }: { items: MediaListItem[]; over?: Over }) {
  const selection = useSelection(items.map((i) => i.id))
  return (
    <TrashView
      items={items}
      selection={selection}
      hasMore={false}
      loadMore={vi.fn()}
      isValidating={false}
      onRestore={vi.fn()}
      now={NOW}
      {...over}
    />
  )
}

beforeEach(() => mockLayout())
afterEach(cleanup)

describe("TrashView", () => {
  it("affiche les jours avant purge et les contenus touchés", () => {
    render(<Harness items={trashed(3)} />)
    expect(screen.getByText("5 jours avant purge")).toBeTruthy()
    expect(screen.getByText("4 jours avant purge")).toBeTruthy()
    expect(screen.getByText("Aucun contenu touché")).toBeTruthy()
    expect(screen.getByText("1 contenu touché (média manquant)")).toBeTruthy()
    expect(screen.getByText("2 contenus touchés (média manquant)")).toBeTruthy()
  })

  it("dernier jour et purge échue", () => {
    const items = trashed(2)
    items[0].purgeAt = new Date(NOW + DAY / 2).toISOString()
    items[1].purgeAt = new Date(NOW - DAY).toISOString()
    render(<Harness items={items} />)
    expect(screen.getByText("1 jour avant purge")).toBeTruthy()
    expect(screen.getByText("Purge imminente")).toBeTruthy()
  })

  it("état vide", () => {
    render(<Harness items={[]} />)
    expect(screen.getByText("La corbeille est vide.")).toBeTruthy()
  })

  it("état d'erreur avec Réessayer", () => {
    const onRetry = vi.fn()
    render(<Harness items={[]} over={{ isError: true, onRetry }} />)
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(onRetry).toHaveBeenCalled()
  })

  it("état de chargement", () => {
    render(<Harness items={[]} over={{ isLoading: true }} />)
    expect(screen.getByRole("status", { name: "Chargement des médias" })).toBeTruthy()
  })

  it("restaurer une ligne appelle onRestore avec son id", () => {
    const onRestore = vi.fn()
    render(<Harness items={trashed(2)} over={{ onRestore }} />)
    const row = document.querySelector<HTMLElement>('[data-media-id="m1"]')!
    fireEvent.click(within(row).getByRole("button", { name: "Restaurer" }))
    expect(onRestore).toHaveBeenCalledWith(["m1"])
  })

  it("un média refusé est marqué", () => {
    render(<Harness items={trashed(2)} over={{ flaggedIds: new Set(["m0"]) }} />)
    expect(document.querySelector('[data-media-id="m0"]')!.getAttribute("data-flagged")).toBe("true")
  })

  it("sans droit d'écriture, la restauration est inactive avec sa raison", () => {
    render(<Harness items={trashed(1)} over={{ writeDisabledReason: "Lecture seule : modification impossible." }} />)
    const btn = screen.getByRole("button", { name: "Restaurer" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it("aucun bouton « Supprimer définitivement » (tâche 23)", () => {
    render(<Harness items={trashed(2)} />)
    expect(screen.queryByRole("button", { name: /définitivement/i })).toBeNull()
  })
})

describe("TrashView, effacement définitif", () => {
  it("bouton absent sans onErase, présent et actif avec", () => {
    const { unmount } = render(<Harness items={trashed(1)} />)
    expect(screen.queryByRole("button", { name: "Effacer définitivement" })).toBeNull()
    unmount()
    const onErase = vi.fn()
    render(<Harness items={trashed(1)} over={{ onErase }} />)
    fireEvent.click(screen.getByRole("button", { name: "Effacer définitivement" }))
    expect(onErase).toHaveBeenCalledWith(["m0"])
  })
})
