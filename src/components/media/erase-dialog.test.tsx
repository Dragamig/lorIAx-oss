// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { EraseDialog } from "./erase-dialog"

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const one = [{ id: "m1", name: "logo.png", affected: 2 }]

describe("EraseDialog", () => {
  it("bouton désactivé tant que le nom n'est pas saisi exactement", () => {
    render(<EraseDialog open onOpenChange={vi.fn()} targets={one} onDone={vi.fn()} />)
    const btn = screen.getByRole("button", { name: "Effacer définitivement" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    const input = screen.getByLabelText("Saisissez le nom du fichier pour confirmer")
    fireEvent.change(input, { target: { value: "logo.pn" } })
    expect(btn.disabled).toBe(true)
    fireEvent.change(input, { target: { value: "logo.png" } })
    expect(btn.disabled).toBe(false)
  })

  it("dit que c'est irréversible, sans Annuler possible, et annonce les emplacements touchés", () => {
    render(<EraseDialog open onOpenChange={vi.fn()} targets={one} onDone={vi.fn()} />)
    expect(screen.getByText("Cette action est irréversible.")).toBeTruthy()
    expect(screen.getByText(/Aucun « Annuler » n'est possible/)).toBeTruthy()
    expect(screen.getByText(/2 emplacements afficheront/)).toBeTruthy()
  })

  it("efface via l'API, toast de succès sans action Annuler", async () => {
    const onDone = vi.fn()
    render(<EraseDialog open onOpenChange={vi.fn()} targets={one} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText("Saisissez le nom du fichier pour confirmer"), { target: { value: "logo.png" } })
    fireEvent.click(screen.getByRole("button", { name: "Effacer définitivement" }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ erasedIds: ["m1"], failedIds: [] }))
    expect(fetchMock).toHaveBeenCalledWith("/api/media/m1/purge", { method: "DELETE" })
    expect(toast.success).toHaveBeenCalledWith("Média effacé définitivement")
  })

  it("lot : confirmation par le nombre, refus signalé", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
    const onDone = vi.fn()
    const two = [one[0], { id: "m2", name: "b.png", affected: 0 }]
    render(<EraseDialog open onOpenChange={vi.fn()} targets={two} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText("Saisissez le nombre de médias pour confirmer"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "Effacer définitivement" }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ erasedIds: ["m1"], failedIds: ["m2"] }))
    expect(toast.error).toHaveBeenCalled()
  })
})
