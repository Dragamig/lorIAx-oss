// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { makeItems } from "../test-fixtures"
import type { SendFn, UploadQueueOptions } from "../upload-queue"
import { useUploadQueue } from "../use-upload-queue"
import { PickerUpload } from "./picker-upload"
import { usePickerUploadSession } from "./use-picker-session"
import type { PickerSelection } from "./use-picker-selection"

const h = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock("next-intl", async () => (await import("../test-fixtures")).intlMock())
vi.mock("sonner", () => ({ toast: { info: h.info, error: h.error, success: h.success } }))

const fetchMock = vi.fn()
let spaces: { id: string; name: string }[]
let percent: number | null

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset())
  spaces = [{ id: "s1", name: "Direction" }]
  percent = 10
  fetchMock.mockReset()
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/media/stats")) return Promise.resolve({ ok: true, json: async () => ({ percent }) })
    if (url.startsWith("/api/spaces")) return Promise.resolve({ ok: true, json: async () => spaces })
    if (url.endsWith("/meta")) return Promise.resolve({ ok: true, json: async () => ({ media: makeItems(1)[0] }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makePicker(): PickerSelection {
  return { selected: [], toggle: vi.fn(), clear: vi.fn(), removeMany: vi.fn(), isSelected: () => false, atMax: false }
}

/** Reproduit le corps du sélecteur : la file et la session d'envoi vivent au-dessus de l'onglet. */
function Harness({
  picker,
  onUploaded,
  queueOptions,
  spaceId,
  accept,
}: {
  picker: PickerSelection
  onUploaded: () => void
  queueOptions: UploadQueueOptions
  spaceId: string | null
  accept: ("image" | "pdf")[]
}) {
  const queue = useUploadQueue(queueOptions)
  usePickerUploadSession(queue, picker, "single", onUploaded)
  return <PickerUpload accept={accept} mode="single" spaceId={spaceId} queue={queue} />
}

function setup(opts: { send?: SendFn; queue?: UploadQueueOptions; spaceId?: string | null; accept?: ("image" | "pdf")[] } = {}) {
  const picker = makePicker()
  const onUploaded = vi.fn()
  const send: SendFn = opts.send ?? (async () => ({ status: 201, body: { id: "m0" } }))
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Harness
        accept={opts.accept ?? ["image"]}
        spaceId={opts.spaceId === undefined ? "s9" : opts.spaceId}
        picker={picker}
        onUploaded={onUploaded}
        queueOptions={{ send, hash: async () => "h", fetchDuplicates: async () => ({}), ...opts.queue }}
      />
    </SWRConfig>
  )
  return { picker, onUploaded, send }
}

const png = () => new File(["a"], "a.png", { type: "image/png" })
const pdf = () => new File(["a"], "a.pdf", { type: "application/pdf" })
const input = () => screen.getByTestId("picker-file-input") as HTMLInputElement
const drop = (f: File) => fireEvent.drop(screen.getByTestId("picker-drop-zone"), { dataTransfer: { files: [f] } })

describe("PickerUpload", () => {
  it("envoie vers l'espace du contexte puis sélectionne le média et rend la main", async () => {
    const send = vi.fn<SendFn>(async () => ({ status: 201, body: { id: "m0" } }))
    const { picker, onUploaded } = setup({ send })
    await waitFor(() => expect((screen.getByTestId("picker-drop-zone") as HTMLElement).getAttribute("aria-disabled")).toBeNull())
    drop(png())
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    expect(send.mock.calls[0][1].spaceId).toBe("s9")
    expect(picker.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: "m0", url: "/api/media/m0" }))
  })

  it("refuse un PDF dans un sélecteur d'images sans l'envoyer", async () => {
    const send = vi.fn<SendFn>(async () => ({ status: 201, body: { id: "m0" } }))
    setup({ send })
    drop(pdf())
    expect((await screen.findByRole("alert")).textContent).toBe("Seules les images peuvent être insérées ici")
    expect(send).not.toHaveBeenCalled()
  })

  it("sans espace de contexte : liste les espaces et envoie vers le choix", async () => {
    spaces = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]
    const send = vi.fn<SendFn>(async () => ({ status: 201, body: { id: "m0" } }))
    setup({ send, spaceId: null })
    const select = (await screen.findByLabelText("Espace")) as HTMLSelectElement
    fireEvent.change(select, { target: { value: "b" } })
    drop(png())
    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0][1].spaceId).toBe("b")
  })

  it("aucun espace inscriptible : dépôt désactivé avec explication", async () => {
    spaces = []
    const send = vi.fn<SendFn>()
    setup({ send, spaceId: null })
    await waitFor(() => expect(screen.getByTestId("picker-drop-zone").getAttribute("aria-disabled")).toBe("true"))
    expect(screen.getByTestId("picker-drop-zone").getAttribute("title")).toBe("Aucun espace où vous pouvez écrire")
    expect(input().disabled).toBe(true)
    drop(png())
    expect(send).not.toHaveBeenCalled()
  })

  it("quota atteint : message et arrêt du reste de la file", async () => {
    const send = vi.fn<SendFn>(async () => ({ status: 507, body: {} }))
    setup({ send, queue: { concurrency: 1 } })
    await waitFor(() => expect(screen.getByTestId("picker-drop-zone").getAttribute("aria-disabled")).toBeNull())
    fireEvent.drop(screen.getByTestId("picker-drop-zone"), { dataTransfer: { files: [png(), png()] } })
    await waitFor(() => expect(screen.getAllByText("Quota atteint")).toHaveLength(2))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("doublon réutilisé : sélectionne l'existant et prévient", async () => {
    const dup = { id: "m0", filename: "a.png", spaceName: "Direction", thumbnailUrl: null }
    const { picker, onUploaded } = setup({ queue: { fetchDuplicates: async () => ({ h: dup }) } })
    await waitFor(() => expect(screen.getByTestId("picker-drop-zone").getAttribute("aria-disabled")).toBeNull())
    drop(png())
    fireEvent.click(await screen.findByRole("button", { name: "Réutiliser l'existant" }))
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    expect(h.info).toHaveBeenCalledWith("Déjà dans la médiathèque")
    expect(picker.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: "m0" }))
  })
})
