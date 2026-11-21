// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { makeItems } from "./test-fixtures"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())

import { TagsDialog } from "./tags-dialog"

afterEach(cleanup)

function threeItems() {
  const items = makeItems(3)
  items[0].tags = [{ id: "t1", label: "Logo" }, { id: "t2", label: "Commun" }]
  items[1].tags = [{ id: "t1", label: "Logo" }, { id: "t2", label: "Commun" }]
  items[2].tags = [{ id: "t2", label: "Commun" }]
  return items
}

describe("TagsDialog", () => {
  it("un tag présent sur 2 médias sur 3 est « sur certains »", () => {
    render(<TagsDialog open onOpenChange={vi.fn()} items={threeItems()} onApply={vi.fn()} />)
    const logo = screen.getByText("Logo").closest("li")!
    expect(logo.textContent).toContain("sur certains")
    expect(screen.getByText("Commun").closest("li")!.textContent).not.toContain("sur certains")
  })

  it("retirer un tag partiel le retire de tous (ids du lot entier côté appelant)", () => {
    const onApply = vi.fn()
    render(<TagsDialog open onOpenChange={vi.fn()} items={threeItems()} onApply={onApply} />)
    fireEvent.click(screen.getByRole("button", { name: "Retirer le tag Logo" }))
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }))
    expect(onApply).toHaveBeenCalledWith([], ["t1"])
  })

  it("création à la volée et annulation d'un retrait en attente", () => {
    const onApply = vi.fn()
    render(<TagsDialog open onOpenChange={vi.fn()} items={threeItems()} onApply={onApply} />)
    fireEvent.click(screen.getByRole("button", { name: "Retirer le tag Logo" }))
    fireEvent.click(screen.getByRole("button", { name: "Conserver le tag Logo" }))
    const input = screen.getByLabelText("Ajouter un tag")
    fireEvent.change(input, { target: { value: "Nouveau" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }))
    expect(onApply).toHaveBeenCalledWith(["Nouveau"], [])
  })

  it("Appliquer désactivé sans changement", () => {
    render(<TagsDialog open onOpenChange={vi.fn()} items={threeItems()} onApply={vi.fn()} />)
    expect((screen.getByRole("button", { name: "Appliquer" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("aucun tag sur la sélection", () => {
    render(<TagsDialog open onOpenChange={vi.fn()} items={makeItems(2)} onApply={vi.fn()} />)
    expect(screen.getByText("Aucun tag sur la sélection")).toBeTruthy()
  })
})
