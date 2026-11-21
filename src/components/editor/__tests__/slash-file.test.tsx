// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { FileBlock } from "../extensions/file-block-node"
import { EditorFilePicker } from "../editor-file-picker"
import { requestFilePicker } from "../media-insert"
import { commands } from "../extensions/slash-commands/commands"
import { getModuleManifests } from "@/lib/modules/registry"
import { OPTIONAL_EDITOR_EXTENSIONS } from "../extensions/optional.generated"

type PickerProps = { open?: boolean; accept?: string[]; onPick: (items: unknown[], opts?: unknown) => unknown; onOpenChange: (o: boolean) => void; finalFocus?: unknown }
const h = vi.hoisted(() => ({ props: null as null | PickerProps }))
vi.mock("@/components/media/picker/media-picker", () => ({
  MediaPicker: (p: PickerProps) => {
    h.props = p
    return null
  },
}))
vi.mock("../extensions/file-block", () => ({ FileBlockView: () => null }))

afterEach(cleanup)

const UUID = "11111111-1111-4111-8111-111111111111"
const mk = () => new Editor({ extensions: [StarterKit, FileBlock] })

describe("commande Fichier", () => {
  it("est déclarée au manifeste du module library et unique dans commands.tsx", () => {
    const lib = getModuleManifests().find((m) => m.id === "library")!
    expect(lib.slashCommands).toContain("Fichier")
    expect(lib.editorExtensions).toContain("FileBlock")
    expect(OPTIONAL_EDITOR_EXTENSIONS.FileBlock).toBe(FileBlock)
    const cmds = commands.filter((c) => c.title === "Fichier")
    expect(cmds).toHaveLength(1)
    expect(cmds[0].module).toBe("library")
    expect(cmds[0].aliases).toEqual(expect.arrayContaining(["pdf", "joindre", "attachment"]))
  })

  it("la commande ouvre le sélecteur sans filtre de type, en sélection simple", () => {
    const editor = mk()
    render(<EditorFilePicker editor={editor as never} />)
    expect(h.props?.open).toBe(false)
    act(() => requestFilePicker(editor as never))
    expect(h.props).toMatchObject({ open: true, mode: "single", tabs: ["library", "upload"] })
    expect(h.props?.accept).toBeUndefined()
  })

  it("choisir un PDF insère un bloc avec les attributs du média", () => {
    const editor = mk()
    render(<EditorFilePicker editor={editor as never} />)
    act(() => requestFilePicker(editor as never))
    act(() => {
      h.props?.onPick([
        { id: UUID, url: `/api/media/${UUID}`, filename: "a.pdf", title: null, altText: null, mimeType: "application/pdf", kind: "document", sizeBytes: 42 },
      ], {})
    })
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "fileBlock",
      attrs: { mediaId: UUID, filename: "a.pdf", mimeType: "application/pdf", size: 42 },
    })
  })

  it("annuler n'insère rien et rend le focus à l'éditeur", () => {
    const editor = mk()
    render(<EditorFilePicker editor={editor as never} />)
    act(() => requestFilePicker(editor as never))
    act(() => h.props?.onOpenChange(false))
    expect(h.props?.open).toBe(false)
    expect(editor.getJSON().content?.some((n) => n.type === "fileBlock")).toBeFalsy()
    expect((h.props?.finalFocus as () => unknown)()).toBe(editor.view.dom)
  })

  it("un bloc Fichier existant reste rendu sans module : le nœud reste enregistré", () => {
    const editor = new Editor({
      extensions: [StarterKit, FileBlock],
      content: { type: "doc", content: [{ type: "fileBlock", attrs: { mediaId: UUID, filename: "a.pdf" } }] },
    })
    expect(editor.getJSON().content?.[0].type).toBe("fileBlock")
  })
})
