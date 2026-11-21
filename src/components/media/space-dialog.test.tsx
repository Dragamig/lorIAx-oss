// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: vi.fn() } }))

import { SpaceDialog } from "./space-dialog"
import { useUndoStack } from "./use-undo-stack"

const spaces = [
  { id: "s1", name: "Direction" },
  { id: "s2", name: "Marketing" },
]
let calls: Record<string, unknown>[]
let status = 200
beforeEach(() => {
  calls = []
  status = 200
  toastSuccess.mockReset()
  toastError.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init!.body)))
      return new Response(JSON.stringify(status === 200 ? { media: {} } : { error: "x" }), { status })
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount(current: { id: string | null; name: string | null }, onChanged = vi.fn(), withUndo = false) {
  function H() {
    const undo = useUndoStack()
    if (withUndo) (globalThis as { __undo?: unknown }).__undo = undo
    return <SpaceDialog open onOpenChange={vi.fn()} mediaId="m0" currentSpace={current} spaces={spaces} onChanged={onChanged} undo={withUndo ? undo : undefined} />
  }
  render(<H />)
  return onChanged
}

describe("SpaceDialog", () => {
  it("avertit du retrait d'accès et désactive la confirmation sur l'espace actuel", () => {
    mount({ id: "s1", name: "Direction" })
    expect(screen.getByText("Les personnes qui ont accès à cet espace n'auront plus accès à ce média.")).toBeTruthy()
    const confirm = screen.getByRole("button", { name: "Changer d'espace" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(confirm.title).toBe("Choisissez un autre espace")
  })

  it("confirmation : PATCH { spaceId } puis toast avec Annuler qui renvoie l'ancien spaceId", async () => {
    const onChanged = mount({ id: "s1", name: "Direction" })
    fireEvent.change(screen.getByLabelText("Espace cible"), { target: { value: "s2" } })
    fireEvent.click(screen.getByRole("button", { name: "Changer d'espace" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(calls[0]).toEqual({ spaceId: "s2" })
    expect(onChanged).toHaveBeenCalled()
    const opts = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } }
    opts.action.onClick()
    await waitFor(() => expect(calls[1]).toEqual({ spaceId: "s1" }))
  })

  it("depuis Hors espace : texte adapté, retour par Annuler envoie null", async () => {
    mount({ id: null, name: null })
    fireEvent.change(screen.getByLabelText("Espace cible"), { target: { value: "s2" } })
    expect(screen.getByText("Ce média sera accessible aux personnes qui ont accès à l'espace choisi.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Changer d'espace" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    ;(toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick()
    await waitFor(() => expect(calls[1]).toEqual({ spaceId: null }))
  })

  it("vers Hors espace : envoie spaceId null", async () => {
    mount({ id: "s1", name: "Direction" })
    fireEvent.change(screen.getByLabelText("Espace cible"), { target: { value: "" } })
    expect(screen.getByText("Seuls son auteur et les administrateurs auront accès à ce média.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Changer d'espace" }))
    await waitFor(() => expect(calls[0]).toEqual({ spaceId: null }))
  })

  it("Ctrl+Z (pile d'annulation) rétablit l'espace d'origine", async () => {
    mount({ id: "s1", name: "Direction" }, vi.fn(), true)
    fireEvent.change(screen.getByLabelText("Espace cible"), { target: { value: "s2" } })
    fireEvent.click(screen.getByRole("button", { name: "Changer d'espace" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    const undo = (globalThis as unknown as { __undo: { undoLast: () => Promise<boolean> } }).__undo
    await undo.undoLast()
    expect(calls[1]).toEqual({ spaceId: "s1" })
  })

  it("erreur 403 : toast d'alerte, rien d'annulable", async () => {
    status = 403
    const onChanged = mount({ id: "s1", name: "Direction" })
    fireEvent.change(screen.getByLabelText("Espace cible"), { target: { value: "s2" } })
    fireEvent.click(screen.getByRole("button", { name: "Changer d'espace" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Droits d'écriture requis sur l'espace cible"))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
