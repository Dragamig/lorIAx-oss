// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

type PickerProps = { open?: boolean; accept?: string[]; onPick: (items: unknown[], opts?: unknown) => unknown; onOpenChange: (o: boolean) => void; finalFocus?: unknown }
const insert = vi.fn()
const fakeCanvas = {}
const pickerProps: { current: PickerProps | null } = { current: null }

vi.mock("next-intl", async () => (await import("../../../media/test-fixtures")).intlMock())
const ctxState: { canvas: unknown } = { canvas: fakeCanvas }
vi.mock("./context", () => ({ useDesignContext: () => ({ fabricCanvas: ctxState.canvas, spaceId: "sp1" }) }))
vi.mock("@/components/media/picker/media-picker", () => ({
  MediaPicker: (p: PickerProps) => {
    pickerProps.current = p
    return p.open ? <div data-testid="picker" /> : null
  },
}))
vi.mock("fabric", () => ({
  FabricImage: {
    fromURL: async (u: string) => {
      insert(u)
      return { width: 10, scaleToWidth() {}, set() {} }
    },
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => cleanup())

describe("ImagePanel", () => {
  it("ouvre le sélecteur image et insère l'URL /api/media choisie sans téléverser", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { ImagePanel } = await import("./panels")
    const canvas = fakeCanvas as Record<string, unknown>
    canvas.getWidth = () => 1000
    canvas.getZoom = () => 1
    canvas.add = vi.fn()
    canvas.setActiveObject = vi.fn()
    canvas.renderAll = vi.fn()
    render(<ImagePanel />)
    fireEvent.click(screen.getAllByRole("button")[0])
    expect(screen.getByTestId("picker")).toBeTruthy()
    expect(pickerProps.current?.accept).toEqual(["image"])
    await pickerProps.current?.onPick([{ id: "m1", url: "/api/media/m1", filename: "a.png" }], {})
    await waitFor(() => expect(insert).toHaveBeenCalledWith("/api/media/m1"))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("ImagePanel : canevas non prêt", () => {
  it("bouton désactivé dont l'info-bulle explique pourquoi, au survol et au clavier", async () => {
    ctxState.canvas = null
    const { ImagePanel } = await import("./panels")
    render(<ImagePanel />)
    const btn = screen.getAllByRole("button")[0] as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute("title")).toBeNull()
    const wrapper = btn.parentElement as HTMLElement
    expect(wrapper.getAttribute("tabindex")).toBe("0")
    fireEvent.focus(wrapper)
    expect(screen.getByRole("tooltip").textContent).toBe("Le canevas n'est pas encore prêt")
    ctxState.canvas = fakeCanvas
  })
})
