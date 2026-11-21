// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())

import { BulkBar } from "./bulk-bar"

afterEach(cleanup)

const handlers = () => ({
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  onMove: vi.fn(),
  onTags: vi.fn(),
  onTrash: vi.fn(),
})

describe("BulkBar", () => {
  it("absente quand la sélection est vide", () => {
    const { container } = render(<BulkBar selectedCount={0} totalCount={5} {...handlers()} />)
    expect(container.firstChild).toBeNull()
  })

  it("annonce le compteur en aria-live et déclenche les actions du registre", () => {
    const h = handlers()
    render(<BulkBar selectedCount={3} totalCount={5} {...h} />)
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite")
    expect(screen.getByRole("status").textContent).toBe("3 médias sélectionnés")
    fireEvent.click(screen.getByRole("button", { name: "Déplacer" }))
    fireEvent.click(screen.getByRole("button", { name: "Modifier les tags" }))
    fireEvent.click(screen.getByRole("button", { name: "Mettre à la corbeille" }))
    fireEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }))
    fireEvent.click(screen.getByRole("button", { name: "Tout désélectionner" }))
    expect(h.onMove).toHaveBeenCalled()
    expect(h.onTags).toHaveBeenCalled()
    expect(h.onTrash).toHaveBeenCalled()
    expect(h.onSelectAll).toHaveBeenCalled()
    expect(h.onClear).toHaveBeenCalled()
  })

  it("« Tout désélectionner » seul quand tout est coché, sans téléchargement groupé", () => {
    render(<BulkBar selectedCount={5} totalCount={5} {...handlers()} />)
    expect(screen.queryByRole("button", { name: "Tout sélectionner" })).toBeNull()
    expect(screen.getByRole("button", { name: "Tout désélectionner" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Télécharger/ })).toBeNull()
  })

  it("lecture seule : actions d'écriture désactivées avec la raison", () => {
    render(<BulkBar selectedCount={1} totalCount={5} {...handlers()} writeDisabledReason="Lecture seule" />)
    expect((screen.getByRole("button", { name: "Déplacer" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("button", { name: "Tout désélectionner" })).toBeTruthy()
  })

  it("en vue Corbeille : Restaurer remplace les actions de rangement", () => {
    const onRestore = vi.fn()
    render(<BulkBar selectedCount={2} totalCount={5} {...handlers()} onRestore={onRestore} />)
    expect(screen.queryByRole("button", { name: "Déplacer" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Modifier les tags" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Mettre à la corbeille" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Restaurer" }))
    expect(onRestore).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Tout désélectionner" })).toBeTruthy()
  })
})

describe("BulkBar, effacement définitif", () => {
  it("visible en corbeille seulement avec onErase", () => {
    const base = { selectedCount: 2, totalCount: 5, onSelectAll: vi.fn(), onClear: vi.fn(), onMove: vi.fn(), onTags: vi.fn(), onTrash: vi.fn(), onRestore: vi.fn() }
    const { unmount } = render(<BulkBar {...base} />)
    expect(screen.queryByRole("button", { name: /Effacer définitivement/ })).toBeNull()
    unmount()
    const onErase = vi.fn()
    render(<BulkBar {...base} onErase={onErase} />)
    fireEvent.click(screen.getByRole("button", { name: /Effacer définitivement/ }))
    expect(onErase).toHaveBeenCalled()
  })
})
