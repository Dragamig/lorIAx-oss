// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())

import { MoveDialog } from "./move-dialog"

afterEach(cleanup)

const folders = [
  { id: "f1", parentId: null, name: "Direction", mediaCount: 0 },
  { id: "f2", parentId: "f1", name: "Contrats", mediaCount: 0 },
]

describe("MoveDialog", () => {
  it("propose « Sans dossier » et les dossiers par chemin", () => {
    render(<MoveDialog open onOpenChange={vi.fn()} folders={folders} onMove={vi.fn()} />)
    const options = screen.getAllByRole("option").map((o) => o.textContent)
    expect(options).toEqual(["Sans dossier", "Direction", "Direction / Contrats"])
  })

  it("valide le dossier choisi", () => {
    const onMove = vi.fn()
    const onOpenChange = vi.fn()
    render(<MoveDialog open onOpenChange={onOpenChange} folders={folders} onMove={onMove} />)
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "f2" } })
    fireEvent.click(screen.getByRole("button", { name: "Déplacer" }))
    expect(onMove).toHaveBeenCalledWith("f2")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("« Sans dossier » envoie null", () => {
    const onMove = vi.fn()
    render(<MoveDialog open onOpenChange={vi.fn()} folders={folders} currentFolderId="f1" onMove={onMove} />)
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Déplacer" }))
    expect(onMove).toHaveBeenCalledWith(null)
  })
})
