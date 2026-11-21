// @vitest-environment jsdom
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { makeItems } from "./test-fixtures"

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: vi.fn(), info: vi.fn() } }))

import { PropertiesPanel } from "./properties-panel"
import { useUndoStack, type UndoStack } from "./use-undo-stack"

type Detail = ReturnType<typeof makeDetail>
function makeDetail(over: Record<string, unknown> = {}) {
  return {
    ...makeItems(1, () => "logo.png")[0],
    id: "m0",
    description: null,
    checksumSha256: null,
    pageCount: null,
    origin: "upload",
    documentId: null,
    deletedBy: null,
    publicShared: false,
    canChangeSpace: false,
    canErase: false,
    tags: [{ id: "t1", label: "marque" }],
    title: "Logo",
    ...over,
  }
}

let detail: Detail
let patchCalls: Record<string, unknown>[]
let patchStatus = 200
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  detail = makeDetail()
  patchCalls = []
  patchStatus = 200
  toastSuccess.mockReset()
  toastError.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/media/m0/meta" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body))
        patchCalls.push(body)
        if (patchStatus !== 200) return json({ error: "Droits insuffisants" }, patchStatus)
        detail = { ...detail, ...body, tags: body.tags ? body.tags.map((l: string, i: number) => ({ id: `n${i}`, label: l })) : detail.tags }
        return json({ media: detail })
      }
      if (url === "/api/media/m0/meta") return json({ media: detail })
      if (url === "/api/media/folders") return json({ folders: [{ id: "f1", parentId: null, name: "Direction", mediaCount: 1 }] })
      if (url === "/api/media/tags") return json({ tags: [] })
      if (url === "/api/media/usages-summary") return json({ perMedia: { m0: { total: 0, visible: 0, hidden: 0 } }, trashRetentionDays: 30 })
      if (url === "/api/media/m0/usages") return json({ entries: [], hiddenCount: 0 })
      if (url === "/api/media/batch") return json({ results: [{ id: "m0", ok: true, previous: { deletedAt: null } }] })
      return json({})
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = async () => {
  const props = { mediaId: "m0", onClose: vi.fn(), onMutated: vi.fn() }
  render(<PropertiesPanel {...props} />)
  await screen.findByLabelText("Titre")
  // Les effets passifs de montage (TextField resynchronise son brouillon sur la valeur) peuvent encore
  // etre en attente sous charge CPU : sans cette purge, ils ecrasent la saisie qui suit (echec instable).
  await act(async () => undefined)
  return props
}
const blur = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } })
  fireEvent.blur(el)
}

describe("PropertiesPanel", () => {
  it("ne rend rien sans média ouvert", () => {
    const { container } = render(<PropertiesPanel mediaId={null} onClose={vi.fn()} onMutated={vi.fn()} />)
    expect(container.innerHTML).toBe("")
  })

  it("nom de fichier vidé : message sous le champ, aucun PATCH", async () => {
    await open()
    blur(screen.getByLabelText("Nom du fichier"), "  ")
    expect(await screen.findByText("Le nom du fichier est obligatoire")).toBeTruthy()
    expect(patchCalls).toEqual([])
  })

  it("titre vidé accepté : PATCH title null", async () => {
    await open()
    blur(screen.getByLabelText("Titre"), "")
    await waitFor(() => expect(patchCalls).toEqual([{ title: null }]))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it("Entrée enregistre le titre", async () => {
    await open()
    const el = screen.getByLabelText("Titre")
    fireEvent.change(el, { target: { value: "Nouveau" } })
    fireEvent.keyDown(el, { key: "Enter" })
    await waitFor(() => expect(patchCalls).toEqual([{ title: "Nouveau" }]))
  })

  it("ajout d'un tag : PATCH de l'ensemble, toast avec Annuler qui restaure", async () => {
    const props = await open()
    const input = screen.getByLabelText("Ajouter un tag")
    fireEvent.change(input, { target: { value: "logo" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(patchCalls[0]).toEqual({ tags: ["marque", "logo"] }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    const [msg, opts] = toastSuccess.mock.calls[0]
    expect(msg).toBe("Tag logo ajouté")
    expect(opts.action.label).toBe("Annuler")
    opts.action.onClick()
    await waitFor(() => expect(patchCalls[1]).toEqual({ tags: ["marque"] }))
    expect(props.onMutated).toHaveBeenCalled()
  })

  it("retrait d'un tag : toast Tag retiré", async () => {
    await open()
    fireEvent.click(screen.getByLabelText("Retirer le tag marque"))
    await waitFor(() => expect(patchCalls[0]).toEqual({ tags: [] }))
    await waitFor(() => expect(toastSuccess.mock.calls[0][0]).toBe("Tag marque retiré"))
  })

  it("lecteur : champs désactivés avec raison", async () => {
    detail = makeDetail({ canWrite: false })
    render(<PropertiesPanel mediaId="m0" onClose={vi.fn()} onMutated={vi.fn()} />)
    const title = (await screen.findByLabelText("Titre")) as HTMLInputElement
    expect(title.disabled).toBe(true)
    expect(title.title).toBe("Droits d'écriture requis pour modifier ce média")
    expect(screen.getByText("Lecture seule")).toBeTruthy()
    expect((screen.getByLabelText("Ajouter un tag") as HTMLInputElement).disabled).toBe(true)
  })

  it("erreur 403 : toast d'erreur et valeur restaurée", async () => {
    await open()
    patchStatus = 403
    const el = screen.getByLabelText("Titre") as HTMLInputElement
    blur(el, "Autre")
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    await waitFor(() => expect(el.value).toBe("Logo"))
  })

  it("Fermer appelle onClose", async () => {
    const props = await open()
    fireEvent.click(screen.getByLabelText("Fermer les propriétés"))
    expect(props.onClose).toHaveBeenCalled()
  })

  it("Copier le lien écrit l'URL absolue", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await open()
    fireEvent.click(screen.getByLabelText("Copier le lien"))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/media/m0`))
    expect(toastSuccess).toHaveBeenCalledWith("Lien copié")
  })

  it("Mettre à la corbeille : batch trash puis fermeture", async () => {
    const props = await open()
    fireEvent.click(screen.getByLabelText("Mettre à la corbeille"))
    fireEvent.click(await screen.findByRole("button", { name: "Mettre à la corbeille", description: "" }))
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === "/api/media/batch")
    expect(JSON.parse(call![1].body)).toEqual({ action: "trash", ids: ["m0"] })
  })

  it("dossier : PATCH folderId", async () => {
    await open()
    await screen.findByRole("option", { name: "Direction" })
    fireEvent.change(screen.getByLabelText("Dossier"), { target: { value: "f1" } })
    await waitFor(() => expect(patchCalls).toEqual([{ folderId: "f1" }]))
  })
  it("Aperçu : appelle onPreview avec l'identifiant du média", async () => {
    const onPreview = vi.fn()
    render(<PropertiesPanel mediaId="m0" onClose={vi.fn()} onMutated={vi.fn()} onPreview={onPreview} />)
    await screen.findByLabelText("Titre")
    fireEvent.click(screen.getByLabelText("Aperçu"))
    expect(onPreview).toHaveBeenCalledWith("m0")
  })

  it("Changer d'espace : absent sans canChangeSpace", async () => {
    render(<PropertiesPanel mediaId="m0" onClose={vi.fn()} onMutated={vi.fn()} spaces={[{ id: "s2", name: "Marketing" }]} />)
    await screen.findByLabelText("Titre")
    expect(screen.queryByLabelText("Changer d'espace")).toBeNull()
  })

  it("Changer d'espace : admin, ouvre le dialogue et envoie PATCH spaceId", async () => {
    detail = makeDetail({ canChangeSpace: true })
    render(<PropertiesPanel mediaId="m0" onClose={vi.fn()} onMutated={vi.fn()} spaces={[{ id: "s2", name: "Marketing" }]} />)
    await screen.findByLabelText("Titre")
    fireEvent.click(screen.getByLabelText("Changer d'espace"))
    fireEvent.change(await screen.findByLabelText("Espace cible"), { target: { value: "s2" } })
    fireEvent.click(screen.getAllByRole("button", { name: "Changer d'espace" }).at(-1)!)
    await waitFor(() => expect(patchCalls).toEqual([{ spaceId: "s2" }]))
  })

  it("clic sur A puis B : la réponse tardive de A est ignorée", async () => {
    let releaseA: (r: Response) => void = () => {}
    const a = new Promise<Response>((r) => (releaseA = r))
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/media/mA/meta") return a
        if (url === "/api/media/mB/meta") return json({ media: makeDetail({ id: "mB", title: "Titre B", filename: "b.png" }) })
        if (url === "/api/media/folders") return json({ folders: [] })
        return json({ entries: [], hiddenCount: 0 })
      }),
    )
    const base = { onClose: vi.fn(), onMutated: vi.fn() }
    const { rerender } = render(<PropertiesPanel mediaId="mA" {...base} />)
    rerender(<PropertiesPanel mediaId="mB" {...base} />)
    expect(((await screen.findByLabelText("Titre")) as HTMLInputElement).value).toBe("Titre B")
    releaseA(json({ media: makeDetail({ id: "mA", title: "Titre A", filename: "a.png" }) }))
    await new Promise((r) => setTimeout(r, 20))
    expect((screen.getByLabelText("Titre") as HTMLInputElement).value).toBe("Titre B")
  })

  it("modification : passe dans la pile Ctrl+Z, qui rétablit l'ancienne valeur", async () => {
    const holder: { stack?: UndoStack } = {}
    function Harness() {
      const undo = useUndoStack()
      useEffect(() => {
        holder.stack = undo
      })
      return <PropertiesPanel mediaId="m0" onClose={vi.fn()} onMutated={vi.fn()} undo={undo} />
    }
    render(<Harness />)
    await waitFor(() => expect(holder.stack).toBeDefined())
    const stack = holder.stack as UndoStack
    await screen.findByLabelText("Titre")
    blur(screen.getByLabelText("Titre"), "Autre")
    await waitFor(() => expect(patchCalls).toEqual([{ title: "Autre" }]))
    await waitFor(() => expect(stack.canUndo()).toBe(true))
    let done = false
    await waitFor(async () => {
      done = await stack.undoLast()
      expect(done).toBe(true)
    })
    await waitFor(() => expect(patchCalls.at(-1)).toEqual({ title: "Logo" }))
    expect(stack.canUndo()).toBe(false)
  })
})
