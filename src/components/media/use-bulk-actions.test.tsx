// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { makeItems } from "./test-fixtures"

const toastSuccess = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t1"))
const toastError = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t2"))
const toastDismiss = vi.hoisted(() => vi.fn())
const toastInfo = vi.hoisted(() => vi.fn((..._a: unknown[]) => "t3"))
vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: toastDismiss, info: toastInfo } }))

import { useBulkActions } from "./use-bulk-actions"
import { useSelection } from "./use-selection"
import { useUndoStack } from "./use-undo-stack"

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
let calls: Record<string, unknown>[]
let respond: (body: Record<string, unknown>) => unknown[]
const onChanged = vi.fn()

function setup(n = 4) {
  const items = makeItems(n)
  return renderHook(() => {
    const selection = useSelection(items.map((i) => i.id))
    const undo = useUndoStack()
    const bulk = useBulkActions({ items, selection, undo, onChanged })
    return { selection, undo, bulk }
  })
}

beforeEach(() => {
  calls = []
  onChanged.mockReset()
  toastSuccess.mockClear()
  toastError.mockClear()
  toastDismiss.mockClear()
  toastInfo.mockClear()
  respond = (b) => (b.ids as string[]).map((id) => ({ id, ok: true, previous: { folderId: null } }))
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/media/tags") {
        return json({ tags: [{ id: "tagNew", label: "Logo", count: 0 }, { id: "tagOld", label: "Vieux", count: 2 }] })
      }
      const body = JSON.parse(String(init!.body))
      calls.push(body)
      return json({ results: respond(body) })
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useBulkActions.move", () => {
  it("lot partiel : décompte, refusés restés sélectionnés et marqués, Annuler limité aux réussis", async () => {
    respond = () => [
      { id: "m0", ok: true, previous: { folderId: "fA" } },
      { id: "m1", ok: true, previous: { folderId: null } },
      { id: "m2", ok: false, error: "forbidden" },
      { id: "m3", ok: false, error: "not_found" },
    ]
    const { result } = setup()
    act(() => result.current.selection.all())
    await act(async () => {
      await result.current.bulk.move(["m0", "m1", "m2", "m3"], "fB")
    })
    expect(calls[0]).toEqual({ action: "move", folderId: "fB", ids: ["m0", "m1", "m2", "m3"] })
    expect(toastError.mock.calls[0][0]).toBe("2 sur 4 déplacés, 2 refusés")
    expect([...result.current.selection.selected].sort()).toEqual(["m2", "m3"])
    expect([...result.current.bulk.flaggedIds].sort()).toEqual(["m2", "m3"])

    const opts = toastError.mock.calls[0][1] as { action: { onClick: () => void } }
    respond = (b) => (b.ids as string[]).map((id) => ({ id, ok: true, previous: { folderId: "fB" } }))
    await act(async () => {
      opts.action.onClick()
    })
    const undoCalls = calls.slice(1)
    expect(undoCalls).toHaveLength(2)
    expect(undoCalls).toContainEqual({ action: "move", folderId: "fA", ids: ["m0"] })
    expect(undoCalls).toContainEqual({ action: "move", folderId: null, ids: ["m1"] })
    expect(undoCalls.flatMap((c) => c.ids as string[]).sort()).toEqual(["m0", "m1"])
  })

  it("lot complet : toast de succès avec Annuler, sélection vidée", async () => {
    const { result } = setup(2)
    act(() => result.current.selection.all())
    await act(async () => {
      await result.current.bulk.move(["m0", "m1"], "fB")
    })
    expect(toastSuccess.mock.calls[0][0]).toBe("2 médias déplacés")
    expect((toastSuccess.mock.calls[0][1] as { action: { label: string } }).action.label).toBe("Annuler")
    expect(result.current.selection.selected.size).toBe(0)
    expect(onChanged).toHaveBeenCalled()
  })

  it("Ctrl+Z (undoLast) exécute l'annulation du dernier déplacement et ferme son toast", async () => {
    const { result } = setup(2)
    await act(async () => {
      await result.current.bulk.move(["m0"], "fB")
    })
    respond = (b) => (b.ids as string[]).map((id) => ({ id, ok: true, previous: { folderId: "fB" } }))
    let done = false
    await act(async () => {
      done = await result.current.undo.undoLast()
    })
    expect(done).toBe(true)
    expect(calls.at(-1)).toEqual({ action: "move", folderId: null, ids: ["m0"] })
    expect(toastDismiss).toHaveBeenCalled()
    await act(async () => {
      done = await result.current.undo.undoLast()
    })
    expect(done).toBe(false)
  })

  it("panne réseau : toast d'erreur, sélection intacte", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })))
    const { result } = setup(2)
    act(() => result.current.selection.all())
    await act(async () => {
      await result.current.bulk.move(["m0", "m1"], null)
    })
    expect(toastError.mock.calls[0][0]).toBe("Déplacement impossible")
    expect(result.current.selection.selected.size).toBe(2)
  })
})

describe("useBulkActions.applyTags", () => {
  it("ajout : tag puis annulation qui retire seulement le tag ajouté, par groupe", async () => {
    respond = (b) =>
      b.action === "tag"
        ? [
            { id: "m0", ok: true, previous: { tagIds: [] } },
            { id: "m1", ok: true, previous: { tagIds: ["tagNew"] } },
          ]
        : (b.ids as string[]).map((id) => ({ id, ok: true, previous: { tagIds: [] } }))
    const { result } = setup(2)
    await act(async () => {
      await result.current.bulk.applyTags(["m0", "m1"], ["Logo"], [])
    })
    expect(calls[0]).toEqual({ action: "tag", tags: ["Logo"], ids: ["m0", "m1"] })
    const opts = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } }
    await act(async () => {
      opts.action.onClick()
    })
    expect(calls[1]).toEqual({ action: "untag", tagIds: ["tagNew"], ids: ["m0"] })
    expect(calls).toHaveLength(2)
  })

  it("retrait : untag envoyé à tous les médias, annulation remet le tag sur ceux qui l'avaient", async () => {
    respond = (b) =>
      b.action === "untag"
        ? [
            { id: "m0", ok: true, previous: { tagIds: ["tagOld"] } },
            { id: "m1", ok: true, previous: { tagIds: [] } },
            { id: "m2", ok: true, previous: { tagIds: ["tagOld"] } },
          ]
        : (b.ids as string[]).map((id) => ({ id, ok: true, previous: { tagIds: [] } }))
    const items = makeItems(3)
    items[0].tags = [{ id: "tagOld", label: "Vieux" }]
    items[2].tags = [{ id: "tagOld", label: "Vieux" }]
    const { result } = renderHook(() => {
      const selection = useSelection(items.map((i) => i.id))
      const undo = useUndoStack()
      return { bulk: useBulkActions({ items, selection, undo, onChanged }) }
    })
    await act(async () => {
      await result.current.bulk.applyTags(["m0", "m1", "m2"], [], ["tagOld"])
    })
    expect(calls[0]).toEqual({ action: "untag", tagIds: ["tagOld"], ids: ["m0", "m1", "m2"] })
    const opts = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } }
    await act(async () => {
      opts.action.onClick()
    })
    expect(calls[1]).toEqual({ action: "tag", tags: ["Vieux"], ids: ["m0", "m2"] })
  })
})

describe("useBulkActions.restore", () => {
  it("restaure, toast avec Annuler qui remet à la corbeille seulement les restaurés", async () => {
    respond = () => [
      { id: "m0", ok: true, previous: { deletedAt: "2026-11-01T00:00:00.000Z" } },
      { id: "m1", ok: true, error: "already", previous: { deletedAt: null } },
    ]
    const { result } = setup(2)
    act(() => result.current.selection.all())
    await act(async () => {
      await result.current.bulk.restore(["m0", "m1"])
    })
    expect(calls[0]).toEqual({ action: "restore", ids: ["m0", "m1"] })
    expect(toastSuccess.mock.calls[0][0]).toBe("2 médias restaurés")
    expect(result.current.selection.selected.size).toBe(0)
    const opts = toastSuccess.mock.calls[0][1] as { action: { label: string; onClick: () => void } }
    expect(opts.action.label).toBe("Annuler")
    respond = (b) => (b.ids as string[]).map((id) => ({ id, ok: true }))
    await act(async () => {
      opts.action.onClick()
    })
    expect(calls[1]).toEqual({ action: "trash", ids: ["m0"] })
  })

  it("lot partiel : décompte, refusés restés sélectionnés, Annuler limité aux réussis", async () => {
    respond = () => [
      { id: "m0", ok: true, previous: { deletedAt: "2026-11-01T00:00:00.000Z" } },
      { id: "m1", ok: false, error: "forbidden" },
    ]
    const { result } = setup(2)
    act(() => result.current.selection.all())
    await act(async () => {
      await result.current.bulk.restore(["m0", "m1"])
    })
    expect(toastError.mock.calls[0][0]).toBe("1 sur 2 restaurés, 1 refusés")
    expect([...result.current.selection.selected]).toEqual(["m1"])
  })

  it("tout déjà restauré : succès sans Annuler", async () => {
    respond = (b) => (b.ids as string[]).map((id) => ({ id, ok: true, error: "already" }))
    const { result } = setup(2)
    await act(async () => {
      await result.current.bulk.restore(["m0"])
    })
    expect(toastSuccess.mock.calls[0][0]).toBe("1 média restauré")
    expect(toastSuccess.mock.calls[0][1]).toEqual({})
  })

  it("erreur réseau : toast d'erreur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })))
    const { result } = setup(2)
    await act(async () => {
      await result.current.bulk.restore(["m0"])
    })
    expect(toastError.mock.calls[0][0]).toBe("Restauration impossible")
  })
})


describe("useBulkActions : annulation d'un toast ancien", () => {
  it("ne s'exécute pas si une action plus récente touche les mêmes médias, toast d'information", async () => {
    const { result } = setup(2)
    await act(async () => {
      await result.current.bulk.move(["m0"], "fB")
    })
    const older = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } }
    await act(async () => {
      await result.current.bulk.move(["m0"], "fC")
    })
    const before = calls.length
    await act(async () => {
      older.action.onClick()
    })
    expect(calls.length).toBe(before)
    expect(toastInfo).toHaveBeenCalledTimes(1)
  })

  it("s'exécute si les médias sont différents", async () => {
    const { result } = setup(2)
    await act(async () => {
      await result.current.bulk.move(["m0"], "fB")
    })
    const older = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } }
    await act(async () => {
      await result.current.bulk.move(["m1"], "fC")
    })
    await act(async () => {
      older.action.onClick()
    })
    expect(calls.at(-1)).toEqual({ action: "move", folderId: null, ids: ["m0"] })
    expect(toastInfo).not.toHaveBeenCalled()
  })
})

describe("useBulkActions.trashed", () => {
  it("annonce, Annuler restaure les mis à la corbeille ; Ctrl+Z ferme le toast", async () => {
    const { result } = setup(3)
    act(() => result.current.selection.all())
    await act(async () => {
      result.current.bulk.trashed(["m0", "m1"], [
        { id: "m0", ok: true },
        { id: "m1", ok: true, error: "already" },
      ])
    })
    expect(toastSuccess.mock.calls[0][0]).toBe("2 médias mis à la corbeille")
    respond = (b) => (b.ids as string[]).map((id) => ({ id, ok: true }))
    await act(async () => {
      await result.current.undo.undoLast()
    })
    expect(calls.at(-1)).toEqual({ action: "restore", ids: ["m0"] })
    expect(toastDismiss).toHaveBeenCalled()
  })

  it("résultat partiel annoncé en erreur, restauration partielle signalée", async () => {
    const { result } = setup(2)
    await act(async () => {
      result.current.bulk.trashed(["m0", "m1"], [
        { id: "m0", ok: true },
        { id: "m1", ok: false, error: "forbidden" },
      ])
    })
    expect(toastError.mock.calls[0][0]).toBe("1 sur 2 mis à la corbeille, 1 refusés")
    respond = () => [{ id: "m0", ok: false, error: "forbidden" }]
    await act(async () => {
      await result.current.undo.undoLast()
    })
    expect(toastError.mock.calls.at(-1)?.[0]).toBe("Annulation impossible")
  })
})
