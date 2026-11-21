// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }))

import { TrashDialog } from "./trash-dialog"

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
let batchCalls: Record<string, unknown>[]
let batchResults: (ids: string[]) => unknown[]
let perMedia: Record<string, unknown>

beforeEach(() => {
  batchCalls = []
  batchResults = (ids) => ids.map((id) => ({ id, ok: true, previous: { deletedAt: null } }))
  perMedia = {}
  toastSuccess.mockReset()
  toastError.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/media/usages-summary") return json({ perMedia, trashRetentionDays: 30 })
      if (url === "/api/media/batch") {
        const body = JSON.parse(String(init!.body))
        batchCalls.push(body)
        return json({ results: batchResults(body.ids) })
      }
      return json({ entries: [], hiddenCount: 0 })
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ids5 = ["a", "b", "c", "d", "e"]
const mount = (ids: string[], onDone = vi.fn()) => {
  render(<TrashDialog open onOpenChange={vi.fn()} ids={ids} onDone={onDone} />)
  return onDone
}

describe("TrashDialog", () => {
  it("lot : « 2 médias sur 5 sont utilisés », rétention, jamais « Supprimer »", async () => {
    perMedia = { a: { total: 1, visible: 1, hidden: 0 }, b: { total: 2, visible: 1, hidden: 1 }, c: { total: 0, visible: 0, hidden: 0 } }
    mount(ids5)
    expect(await screen.findByText("2 médias sur 5 sont utilisés")).toBeTruthy()
    expect(screen.getByText("Restaurable pendant 30 jours depuis la corbeille.")).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Supprimer/)
  })

  it("confirmation : trash puis Annuler envoie restore avec les mêmes ids", async () => {
    mount(ids5)
    await screen.findByText("0 médias sur 5 sont utilisés")
    fireEvent.click(screen.getByRole("button", { name: "Mettre à la corbeille" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(batchCalls[0]).toEqual({ action: "trash", ids: ids5 })
    expect(toastSuccess.mock.calls[0][0]).toBe("5 médias mis à la corbeille")
    toastSuccess.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(batchCalls[1]).toEqual({ action: "restore", ids: ids5 }))
  })

  it("avec onTrashed : pas de toast propre, le résultat est confié à l'appelant", async () => {
    const onTrashed = vi.fn()
    const onDone = vi.fn()
    render(<TrashDialog open onOpenChange={vi.fn()} ids={["a", "b"]} onDone={onDone} onTrashed={onTrashed} />)
    await screen.findByText("0 médias sur 2 sont utilisés")
    fireEvent.click(screen.getByRole("button", { name: "Mettre à la corbeille" }))
    await waitFor(() => expect(onTrashed).toHaveBeenCalled())
    expect(onTrashed.mock.calls[0][0]).toEqual(["a", "b"])
    expect(onTrashed.mock.calls[0][1]).toHaveLength(2)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalled()
  })

  it("résultat partiel : décompte en toast d'erreur, seuls les réussis sont annulables", async () => {
    batchResults = (ids) => ids.map((id, i) => (i < 3 ? { id, ok: true } : { id, ok: false, error: "forbidden" }))
    const onDone = mount(ids5)
    await screen.findByText("0 médias sur 5 sont utilisés")
    fireEvent.click(screen.getByRole("button", { name: "Mettre à la corbeille" }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toBe("3 sur 5 mis à la corbeille, 2 refusés")
    toastError.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(batchCalls[1]).toEqual({ action: "restore", ids: ["a", "b", "c"] }))
    expect(onDone).toHaveBeenCalled()
  })
})
