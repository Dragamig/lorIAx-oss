// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))
vi.mock("@/components/editor/studio-shell", () => ({
  StudioTopbar: (p: { right: React.ReactNode }) => <div>{p.right}</div>,
}))

import { DesignContext, type DesignContextValue } from "./context"
import { DesignTopbar } from "./toolbar"

afterEach(cleanup)

function setup() {
  const value = {
    title: "T", setTitle: vi.fn(), handleUndo: vi.fn(), handleRedo: vi.fn(), triggerSave: vi.fn(),
    handleSaveAsTemplate: vi.fn(), handleExport: vi.fn(), handleSaveToLibrary: h.save, onClose: vi.fn(),
    fabricCanvas: null, canUndo: false, canRedo: false, bgColor: "#fff", handleBgColorChange: vi.fn(),
    pageSize: { width: 100, height: 100 },
  } as unknown as DesignContextValue
  render(
    <DesignContext.Provider value={value}>
      <DesignTopbar />
    </DesignContext.Provider>,
  )
  fireEvent.click(screen.getByTitle("Plus d'actions"))
}

describe("DesignTopbar, enregistrer dans la médiathèque", () => {
  it("le bouton a un aria-label et une info-bulle", () => {
    h.save.mockReset()
    setup()
    const btn = screen.getByRole("button", { name: "saveToLibrary" })
    expect(btn.getAttribute("title")).toBe("saveToLibrary")
  })
  it("le clic appelle handleSaveToLibrary avec la résolution et la transparence", () => {
    h.save.mockReset()
    setup()
    fireEvent.click(screen.getByRole("button", { name: "saveToLibrary" }))
    expect(h.save).toHaveBeenCalledWith(300, { transparent: false })
  })
})
