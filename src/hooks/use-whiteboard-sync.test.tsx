// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({ toastErr: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: h.toastErr } }))
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))

import { useWhiteboardSync } from "./use-whiteboard-sync"

const CANVAS = "0b1c2d3e-0000-4000-8000-0000000000c1"
const DOC = "0b1c2d3e-0000-4000-8000-0000000000d1"
const MEDIA = "0b1c2d3e-0000-4000-8000-0000000000a1"
const img = { type: "image", id: "e1", customData: { mediaId: MEDIA } }

const fetchMock = vi.fn()
const usagesCalls = () =>
  fetchMock.mock.calls.filter(([u]) => u === "/api/media/usages/explicit").map(([, init]) => JSON.parse(init.body))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  h.toastErr.mockReset()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST" || init?.method === "PUT") return { ok: true, json: async () => ({}) }
    return { ok: true, json: async () => ({ elements: [] }) }
  })
  vi.stubGlobal("fetch", fetchMock)
  ;(window as unknown as { __loriax_spaceId?: string }).__loriax_spaceId = "space-1"
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function save(result: { current: ReturnType<typeof useWhiteboardSync> }, elements: unknown[]) {
  await waitFor(() => expect(result.current.isSynced).toBe(true))
  act(() => result.current.onExcalidrawChange(elements as never))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100)
  })
}

describe("useWhiteboardSync, usages explicites", () => {
  it("après un POST réussi, PUT usages/explicit part avec targetType whiteboard et les ids", async () => {
    const { result } = renderHook(() => useWhiteboardSync(CANVAS, DOC))
    await save(result, [img])
    await waitFor(() => expect(usagesCalls()).toHaveLength(1))
    expect(usagesCalls()[0]).toMatchObject({
      targetType: "whiteboard",
      targetId: CANVAS,
      documentId: DOC,
      spaceId: "space-1",
      mediaIds: [MEDIA],
    })
  })

  it("retirer l'image de la scène retire l'usage (liste vide au deuxième appel)", async () => {
    const { result } = renderHook(() => useWhiteboardSync(CANVAS, DOC))
    await save(result, [img])
    await save(result, [{ ...img, isDeleted: true }])
    await waitFor(() => expect(usagesCalls()).toHaveLength(2))
    expect(usagesCalls()[1].mediaIds).toEqual([])
  })

  it("aucun appel d'usages tant qu'il n'y a jamais eu d'image", async () => {
    const { result } = renderHook(() => useWhiteboardSync(CANVAS, DOC))
    await save(result, [{ type: "rectangle" }])
    expect(usagesCalls()).toHaveLength(0)
  })

  it("un échec des usages affiche un toast sans bloquer", async () => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/media/usages/explicit") return { ok: false }
      if (init?.method === "POST") return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => ({ elements: [] }) }
    })
    const { result } = renderHook(() => useWhiteboardSync(CANVAS, DOC))
    await save(result, [img])
    await waitFor(() => expect(h.toastErr).toHaveBeenCalledWith("usageSyncFailed"))
  })
})
