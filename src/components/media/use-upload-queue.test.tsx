// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { UploadItem, UploadQueue } from "./upload-queue"

const h = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }))

import { useBatchToast } from "./use-upload-queue"

function fakeQueue() {
  let items: UploadItem[] = []
  const listeners = new Set<() => void>()
  const queue = {
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    snapshot: () => items,
  } as unknown as UploadQueue
  return {
    queue,
    set(next: UploadItem[]) {
      items = next
      listeners.forEach((l) => l())
    },
  }
}
const it_ = (id: string, status: UploadItem["status"], extra: Partial<UploadItem> = {}): UploadItem => ({
  id,
  name: `${id}.png`,
  size: 1,
  status,
  progress: 0,
  mediaId: status === "done" ? `m-${id}` : undefined,
  ...extra,
})

const fetchMock = vi.fn()
beforeEach(() => {
  h.success.mockReset()
  h.error.mockReset()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useBatchToast", () => {
  it("le toast du 2e lot ne compte que le 2e lot, même après un nouveau rendu", async () => {
    const q = fakeQueue()
    const { rerender } = renderHook(() => useBatchToast(q.queue, () => {}))
    act(() => q.set([it_("u1", "uploading"), it_("u2", "uploading")]))
    act(() => q.set([it_("u1", "done"), it_("u2", "done")]))
    expect(h.success).toHaveBeenLastCalledWith("2 fichiers ajoutés", expect.anything())
    rerender()
    act(() => q.set([it_("u1", "done"), it_("u2", "done"), it_("u3", "uploading")]))
    act(() => q.set([it_("u1", "done"), it_("u2", "done"), it_("u3", "done")]))
    expect(h.success).toHaveBeenCalledTimes(2)
    const [message, opts] = h.success.mock.calls[1]
    expect(message).toBe("1 fichier ajouté")
    opts.action.onClick()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).ids).toEqual(["m-u3"])
  })

  it("un doublon réutilisé passe en done : toast et rafraîchissement", () => {
    const q = fakeQueue()
    const onMutated = vi.fn()
    renderHook(() => useBatchToast(q.queue, onMutated))
    act(() => q.set([it_("u1", "duplicate")]))
    act(() => q.set([it_("u1", "done", { reused: true })]))
    expect(h.success).toHaveBeenCalledTimes(1)
    expect(onMutated).toHaveBeenCalled()
  })
})
