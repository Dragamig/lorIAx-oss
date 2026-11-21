// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import fr from "../../../messages/fr.json"
import { ActionButton } from "./action-button"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], fr) as string,
}))

afterEach(cleanup)

describe("ActionButton", () => {
  it("porte l'aria-label du registre", () => {
    render(<ActionButton id="undo" onAction={() => {}} />)
    expect(screen.getByRole("button", { name: "Annuler" })).toBeTruthy()
  })

  it("affiche l'info-bulle avec raccourci au focus et au survol", () => {
    render(<ActionButton id="undo" onAction={() => {}} />)
    const b = screen.getByRole("button")
    expect(screen.queryByRole("tooltip")).toBeNull()
    fireEvent.focus(b)
    expect(screen.getByRole("tooltip").textContent).toBe("Annuler (Ctrl+Z)")
    fireEvent.blur(b)
    expect(screen.queryByRole("tooltip")).toBeNull()
    fireEvent.mouseEnter(b)
    expect(screen.getByRole("tooltip").textContent).toBe("Annuler (Ctrl+Z)")
  })

  it("désactivé avec raison : info-bulle égale à la raison, describedby, clic sans effet", () => {
    const onAction = vi.fn()
    render(<ActionButton id="resetFilters" onAction={onAction} disabledReason="Aucun filtre actif" />)
    const b = screen.getByRole("button") as HTMLButtonElement
    expect(b.disabled).toBe(true)
    fireEvent.mouseEnter(b)
    const tip = screen.getByRole("tooltip")
    expect(tip.textContent).toBe("Aucun filtre actif")
    expect(b.getAttribute("aria-describedby")).toBe(tip.id)
    fireEvent.click(b)
    expect(onAction).not.toHaveBeenCalled()
  })

  it("appelle onAction au clic", () => {
    const onAction = vi.fn()
    render(<ActionButton id="download" onAction={onAction} />)
    fireEvent.click(screen.getByRole("button"))
    expect(onAction).toHaveBeenCalledOnce()
  })
})
