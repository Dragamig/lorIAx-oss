// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())

import { ReplaceFileDialog, replaceErrorKey } from "./replace-file-dialog"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal("fetch", fetchMock))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  fetchMock.mockReset()
})

const setup = () => {
  const props = { onOpenChange: vi.fn(), onReplaced: vi.fn(), onStale: vi.fn() }
  render(<ReplaceFileDialog open mediaId="m1" expectedVersion={3} usageCount={0} {...props} />)
  fireEvent.change(screen.getByTestId("replace-file-input"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } })
  return props
}

describe("ReplaceFileDialog", () => {
  it("Remplacer est désactivé sans fichier, avec la raison", () => {
    render(<ReplaceFileDialog open mediaId="m1" expectedVersion={3} usageCount={0} onOpenChange={vi.fn()} onReplaced={vi.fn()} onStale={vi.fn()} />)
    expect((screen.getByRole("button", { name: "Remplacer" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Ce média n'est utilisé nulle part.")).toBeTruthy()
    expect(screen.getByText("Choisissez un fichier pour continuer")).toBeTruthy()
  })

  it.each([
    [415, "Une version doit rester du même type", { error: "Le type du fichier ne peut pas changer" }],
    [409, "Ce fichier est identique", { error: "Le fichier est identique à la version courante" }],
    [409, "Ce média est dans la corbeille", { error: "Média en corbeille" }],
    [507, "Quota de stockage atteint", { error: "Quota de stockage atteint" }],
  ])("statut %i : message clair, la modale reste ouverte", async (status, text, body) => {
    fetchMock.mockResolvedValue(json(body, status))
    const props = setup()
    fireEvent.click(screen.getByRole("button", { name: "Remplacer" }))
    expect((await screen.findByRole("alert")).textContent).toContain(text)
    expect(props.onReplaced).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("409 de version périmée : message de conflit et rechargement demandé", async () => {
    fetchMock.mockResolvedValue(json({ error: "Version périmée" }, 409))
    const props = setup()
    fireEvent.click(screen.getByRole("button", { name: "Remplacer" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Un collègue vient de remplacer ce fichier")
    expect(props.onStale).toHaveBeenCalled()
  })

  it("succès : ferme et rend la version créée", async () => {
    fetchMock.mockResolvedValue(json({ version: { version: 4 }, media: { currentVersion: 4 } }))
    const props = setup()
    fireEvent.click(screen.getByRole("button", { name: "Remplacer" }))
    await waitFor(() => expect(props.onReplaced).toHaveBeenCalledWith({ version: { version: 4 }, currentVersion: 4 }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("replaceErrorKey distingue les statuts", () => {
    expect(replaceErrorKey(413, undefined)).toBe("errTooLarge")
    expect(replaceErrorKey(403, undefined)).toBe("errForbidden")
    expect(replaceErrorKey(500, undefined)).toBe("errGeneric")
  })
})
