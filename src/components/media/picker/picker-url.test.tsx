// @vitest-environment jsdom
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { makeItems } from "../test-fixtures"
import { PickerUrl } from "./picker-url"
import { useImportGuard } from "./use-picker-session"
import type { PickerSelection } from "./use-picker-selection"

const h = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("next-intl", async () => (await import("../test-fixtures")).intlMock())
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, info: vi.fn() } }))

const fetchMock = vi.fn()
beforeEach(() => {
  h.success.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const abortRef: { current: (() => void) | null } = { current: null }
function Harness({ picker, onImported }: { picker: PickerSelection; onImported: () => void }) {
  const imports = useImportGuard()
  useEffect(() => {
    abortRef.current = imports.abortAll
  })
  return <PickerUrl mode="single" spaceId="s1" picker={picker} imports={imports} onImported={onImported} />
}

function setup() {
  const picker: PickerSelection = { selected: [], toggle: vi.fn(), clear: vi.fn(), removeMany: vi.fn(), isSelected: () => false, atMax: false }
  const onImported = vi.fn()
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <Harness picker={picker} onImported={onImported} />
    </SWRConfig>
  )
  return { picker, onImported }
}

describe("PickerUrl", () => {
  it("désactive l'import tant que le champ est vide", () => {
    setup()
    const btn = screen.getByRole("button", { name: "Importer l'image" })
    expect(btn).toHaveProperty("disabled", true)
  })

  it("importe, sélectionne le média et revient sur la médiathèque", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ media: makeItems(1)[0] }) })
    const { picker, onImported } = setup()
    fireEvent.change(screen.getByLabelText("Adresse de l'image"), { target: { value: "https://a.b/c.png" } })
    fireEvent.click(screen.getByRole("button", { name: "Importer l'image" }))
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(picker.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: "m0", url: "/api/media/m0" }))
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ url: "https://a.b/c.png", origin: "upload", spaceId: "s1" })
    expect(h.success).toHaveBeenCalled()
  })

  it("affiche l'erreur du serveur en role=alert, sans toast de succès ni sélection", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "url_refused" }) })
    const { picker, onImported } = setup()
    fireEvent.change(screen.getByLabelText("Adresse de l'image"), { target: { value: "http://127.0.0.1/x.png" } })
    fireEvent.click(screen.getByRole("button", { name: "Importer l'image" }))
    expect((await screen.findByRole("alert")).textContent).toBe("Adresse refusée")
    expect(picker.toggle).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
    expect(h.success).not.toHaveBeenCalled()
  })

  it("la fermeture annule la requête réseau (AbortSignal transmis à fetch)", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    setup()
    fireEvent.change(screen.getByLabelText("Adresse de l'image"), { target: { value: "https://a.b/c.png" } })
    fireEvent.click(screen.getByRole("button", { name: "Importer l'image" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal.aborted).toBe(false)
    abortRef.current?.()
    expect(signal.aborted).toBe(true)
  })

  it("sélecteur fermé pendant l'import : résultat ignoré, ni sélection ni toast", async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise((r) => (resolveFetch = r)))
    const { picker, onImported } = setup()
    fireEvent.change(screen.getByLabelText("Adresse de l'image"), { target: { value: "https://a.b/c.png" } })
    fireEvent.click(screen.getByRole("button", { name: "Importer l'image" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // Pendant l'import, le bouton reste désactivé : pas de second envoi possible.
    expect(screen.getByRole("button", { name: "Importer l'image" })).toHaveProperty("disabled", true)
    abortRef.current?.()
    resolveFetch({ ok: true, json: async () => ({ media: makeItems(1)[0] }) })
    await new Promise((r) => setTimeout(r, 20))
    expect(picker.toggle).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
    expect(h.success).not.toHaveBeenCalled()
  })
})
