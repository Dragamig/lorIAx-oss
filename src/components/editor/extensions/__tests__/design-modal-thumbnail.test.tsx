// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  canvasProps: null as null | { onSave: (d: unknown, t: string) => void; onClose: () => void },
  upload: vi.fn(),
  postBatch: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("next/dynamic", () => ({
  default: () => (props: NonNullable<typeof h.canvasProps>) => {
    h.canvasProps = props
    return <div data-testid="canvas" />
  },
}))
vi.mock("@/hooks/use-block-lock", () => ({
  useBlockLock: () => ({ isLockedByOther: false, acquireLock: vi.fn(), releaseLock: vi.fn() }),
}))
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }))
vi.mock("../design-thumbnail", () => ({ uploadDesignThumbnail: h.upload }))
vi.mock("@/components/media/bulk-api", () => ({ postBatch: h.postBatch }))

import { DesignModal } from "../design-modal"

const OLD = "0b1c2d3e-0000-4000-8000-000000000001"
const NEW = "0b1c2d3e-0000-4000-8000-000000000002"
const fetchMock = vi.fn()

beforeEach(() => {
  h.canvasProps = null
  h.upload.mockReset()
  h.postBatch.mockReset()
  h.toastError.mockReset()
  h.upload.mockResolvedValue(`/api/media/${NEW}`)
  h.postBatch.mockResolvedValue([])
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal("fetch", fetchMock)
  ;(window as unknown as { __loriax_spaceId?: string }).__loriax_spaceId = "sp-doc"
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(thumbnailUrl: string | null = `/api/media/${OLD}`) {
  const updateAttributes = vi.fn()
  const onClose = vi.fn()
  render(
    <DesignModal
      designId="d1"
      documentId="doc1"
      title="T"
      lockedBy={null}
      lockedAt={null}
      thumbnailUrl={thumbnailUrl}
      onClose={onClose}
      updateAttributes={updateAttributes}
    />
  )
  return { updateAttributes, onClose }
}

describe("DesignModal : miniature", () => {
  it("l'enregistrement automatique n'envoie aucune miniature, un seul envoi à la fermeture, avec l'espace du document", async () => {
    const { updateAttributes, onClose } = setup()
    await waitFor(() => expect(h.canvasProps).not.toBeNull())
    for (const t of ["data:image/jpeg;base64,A", "data:image/jpeg;base64,B", "data:image/jpeg;base64,C"]) {
      await h.canvasProps!.onSave({ pages: [] }, t)
    }
    expect(h.upload).not.toHaveBeenCalled()
    h.canvasProps!.onClose()
    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1))
    expect(h.upload).toHaveBeenCalledWith("data:image/jpeg;base64,C", "sp-doc")
    await waitFor(() => expect(updateAttributes).toHaveBeenCalledWith({ thumbnailUrl: `/api/media/${NEW}` }))
    expect(onClose).toHaveBeenCalled()
    h.canvasProps!.onClose()
    expect(h.upload).toHaveBeenCalledTimes(1)
  })

  it("la miniature précédente n'est jamais mise à la corbeille ni supprimée", async () => {
    setup()
    await waitFor(() => expect(h.canvasProps).not.toBeNull())
    await h.canvasProps!.onSave({ pages: [] }, "data:image/jpeg;base64,A")
    h.canvasProps!.onClose()
    await waitFor(() => expect(h.upload).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(h.postBatch).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false)
  })

  it("ne touche pas à une ancienne miniature qui n'est pas un média", async () => {
    setup("designs/org/a.jpg")
    await waitFor(() => expect(h.canvasProps).not.toBeNull())
    await h.canvasProps!.onSave({ pages: [] }, "data:image/jpeg;base64,A")
    h.canvasProps!.onClose()
    await waitFor(() => expect(h.upload).toHaveBeenCalled())
    expect(h.postBatch).not.toHaveBeenCalled()
  })

  it("envoi échoué : on garde la valeur data: et on n'envoie rien à la corbeille", async () => {
    h.upload.mockResolvedValue(null)
    const { updateAttributes } = setup()
    await waitFor(() => expect(h.canvasProps).not.toBeNull())
    await h.canvasProps!.onSave({ pages: [] }, "data:image/jpeg;base64,A")
    h.canvasProps!.onClose()
    await waitFor(() => expect(updateAttributes).toHaveBeenCalledWith({ thumbnailUrl: "data:image/jpeg;base64,A" }))
    expect(h.postBatch).not.toHaveBeenCalled()
  })

  it("sans miniature produite : aucun envoi", async () => {
    setup()
    await waitFor(() => expect(h.canvasProps).not.toBeNull())
    await h.canvasProps!.onSave({ pages: [] }, "")
    h.canvasProps!.onClose()
    expect(h.upload).not.toHaveBeenCalled()
  })

  it("handleSave appelle PUT usages/explicit avec targetType design et targetId du design", async () => {
    const A = "0b1c2d3e-0000-4000-8000-00000000000a"
    setup()
    await waitFor(() => expect(h.canvasProps).not.toBeNull())
    await h.canvasProps!.onSave({ pages: [{ src: `/api/media/${A}` }] }, "")
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/media/usages/explicit")
    expect(call).toBeTruthy()
    expect(call![1].method).toBe("PUT")
    expect(JSON.parse(call![1].body)).toEqual({
      targetType: "design", targetId: "d1", documentId: "doc1", spaceId: "sp-doc", mediaIds: [A],
    })
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it("échec de la synchro des usages : toast d'erreur, sauvegarde non bloquée", async () => {
    fetchMock.mockImplementation(async (u: string) => ({ ok: u !== "/api/media/usages/explicit", json: async () => ({}) }))
    setup()
    await waitFor(() => expect(h.canvasProps).not.toBeNull())
    await h.canvasProps!.onSave({ pages: [] }, "")
    expect(h.toastError).toHaveBeenCalledWith("usageSyncFailed")
  })
})
