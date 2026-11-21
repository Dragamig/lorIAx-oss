// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { intlMock } from "./test-fixtures"
import { UploadDialog } from "./upload-dialog"
import { createUploadQueue } from "./upload-queue"

vi.mock("next-intl", () => intlMock())
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(cleanup)

const spaces = [{ id: "s1", name: "Direction" }]
const base = { open: true, onClose: () => {}, target: { spaceId: null, folderId: null }, spaces, folders: [] }
const mk = () => createUploadQueue({ send: async () => ({ status: 201, body: { id: "x" } }), hash: async () => "h", fetchDuplicates: async () => ({}) })
const png = () => new File(["a"], "a.png", { type: "image/png" })

describe("UploadDialog", () => {
  it("à 100 % de quota : zone de dépôt et bouton désactivés avec explication", () => {
    render(<UploadDialog {...base} queue={mk()} stats={{ percent: 100 }} />)
    expect(screen.getByTestId("drop-zone").getAttribute("aria-disabled")).toBe("true")
    expect((screen.getByTestId("file-input") as HTMLInputElement).disabled).toBe(true)
    const btn = screen.getByRole("button", { name: "Téléverser" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.parentElement?.getAttribute("title")).toBe("Téléversement indisponible : quota atteint")
    expect(screen.getByTestId("quota-banner").textContent).toContain("Quota atteint")
  })

  it("espace sans valeur : Téléverser désactivé avec la raison", () => {
    render(<UploadDialog {...base} queue={mk()} stats={{ percent: 10 }} initialFiles={[png()]} />)
    const btn = screen.getByRole("button", { name: "Téléverser" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.parentElement?.getAttribute("title")).toBe("Choisissez un espace")
    fireEvent.change(screen.getByLabelText("Espace"), { target: { value: "s1" } })
    expect((screen.getByRole("button", { name: "Téléverser" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("un non-admin ne voit pas Hors espace, un admin le voit", () => {
    const { rerender } = render(<UploadDialog {...base} queue={mk()} />)
    expect(screen.queryByRole("option", { name: "Hors espace" })).toBeNull()
    rerender(<UploadDialog {...base} queue={mk()} isAdmin />)
    expect(screen.getByRole("option", { name: "Hors espace" })).toBeTruthy()
  })

  it("avertissement à 80 %", () => {
    render(<UploadDialog {...base} queue={mk()} stats={{ percent: 85 }} />)
    expect(screen.getByTestId("quota-banner").textContent).toBe("Stockage à 85 %")
  })
})
