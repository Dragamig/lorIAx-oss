// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  api: { getSceneElements: () => [], getAppState: () => ({}), getFiles: () => ({}) },
}))

vi.mock("next/dynamic", () => ({
  default: () => (props: { excalidrawAPI: (a: unknown) => void }) => {
    props.excalidrawAPI(h.api)
    return <div data-testid="excalidraw" />
  },
}))
vi.mock("@excalidraw/excalidraw/index.css", () => ({}))
vi.mock("@excalidraw/excalidraw", () => ({
  exportToBlob: async () => new Blob(["x"], { type: "image/png" }),
}))
vi.mock("@/hooks/use-whiteboard-sync", () => ({
  useWhiteboardSync: () => ({ initialElements: [], onExcalidrawChange: vi.fn(), isSynced: true }),
}))
vi.mock("@/hooks/use-whiteboard-library", () => ({
  useWhiteboardLibrary: () => ({ libraryItems: [], onLibraryChange: vi.fn(), isLoaded: true }),
}))
vi.mock("@/contexts/theme-context", () => ({ useTheme: () => ({ darkMode: false }) }))
vi.mock("../whiteboard-library", () => ({ WhiteboardLibraryButton: () => null }))
vi.mock("../design-thumbnail", () => ({ uploadDesignThumbnail: h.upload }))

import { WhiteboardModal } from "../whiteboard-modal"

beforeEach(() => {
  h.upload.mockReset()
  ;(window as unknown as { __loriax_spaceId?: string }).__loriax_spaceId = "space-1"
})
afterEach(cleanup)

async function closeModal(onClose: (u?: string) => void) {
  render(<WhiteboardModal canvasId="c1" documentId="d1" title="T" onClose={onClose} />)
  await screen.findByTestId("excalidraw")
  fireEvent.click(screen.getByRole("button", { name: "Fermer le tableau blanc" }))
}

describe("WhiteboardModal handleClose", () => {
  it("passe /api/media/<id> à onClose quand l'envoi réussit", async () => {
    h.upload.mockResolvedValue("/api/media/abc")
    const onClose = vi.fn()
    await closeModal(onClose)
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("/api/media/abc"))
    expect(h.upload).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png/), "space-1")
  })

  it("repasse le data URL quand l'envoi échoue", async () => {
    h.upload.mockResolvedValue(null)
    const onClose = vi.fn()
    await closeModal(onClose)
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png/)))
  })
})
