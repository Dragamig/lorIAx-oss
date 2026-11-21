// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { resolveThumbnailSrc, uploadDesignThumbnail } from "../design-thumbnail"

vi.mock("@/hooks/use-block-lock", () => ({ useBlockLock: () => ({ isLockedByOther: false }) }))
vi.mock("../design-modal", () => ({ DesignModal: () => null }))
vi.mock("@/components/editor/modal-lock-banner", () => ({ ModalLockBanner: () => null }))
vi.mock("@tiptap/react", () => ({ NodeViewWrapper: (p: { children: React.ReactNode }) => <div>{p.children}</div> }))

const ID = "0b1c2d3e-0000-4000-8000-000000000000"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("resolveThumbnailSrc", () => {
  it("garde data:, http et /api/media/<uuid>", () => {
    expect(resolveThumbnailSrc("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA")
    expect(resolveThumbnailSrc("https://x.test/a.png")).toBe("https://x.test/a.png")
    expect(resolveThumbnailSrc(`/api/media/${ID}`)).toBe(`/api/media/${ID}`)
  })
  it("préfixe la clé relative ancienne", () => {
    expect(resolveThumbnailSrc("designs/org/a.jpg")).toBe("/api/attachments/designs/org/a.jpg")
  })
  it("rend null pour une valeur vide", () => {
    expect(resolveThumbnailSrc(null)).toBeNull()
    expect(resolveThumbnailSrc("")).toBeNull()
  })
})

describe("uploadDesignThumbnail", () => {
  it("enregistre la miniature et rend /api/media/<id>", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("data:")) return { blob: async () => new Blob(["x"], { type: "image/jpeg" }) } as Response
      return { ok: true, json: async () => ({ id: ID }) } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const url = await uploadDesignThumbnail("data:image/jpeg;base64,QUJD")
    expect(url).toBe(`/api/media/${ID}`)
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/images", expect.objectContaining({ method: "POST" }))
  })
  it("rend null en cas d'échec pour garder la valeur data:", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.startsWith("data:")
        ? ({ blob: async () => new Blob(["y"], { type: "image/jpeg" }) } as Response)
        : ({ ok: false, status: 507 } as Response)))
    expect(await uploadDesignThumbnail("data:image/jpeg;base64,REVG")).toBeNull()
  })
  it("ignore une valeur qui n'est pas une image data:", async () => {
    expect(await uploadDesignThumbnail("/api/media/x")).toBeNull()
  })
})

describe("DesignBlockView, miniature manquante", () => {
  it("affiche l'icône par défaut quand l'image rend une erreur", async () => {
    const { DesignBlockView } = await import("../design-block")
    const props = {
      node: { attrs: { designId: "d", title: "T", thumbnailUrl: `/api/media/${ID}` } },
      updateAttributes: vi.fn(),
      editor: { isEditable: true },
      selected: false,
      deleteNode: vi.fn(),
    } as unknown as Parameters<typeof DesignBlockView>[0]
    const { container } = render(<DesignBlockView {...props} />)
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(`/api/media/${ID}`)
    fireEvent.error(img as Element)
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("Cliquer pour ouvrir Studio")).toBeTruthy()
  })

  it("miniature à la corbeille : icône par défaut sans attendre une erreur de chargement", async () => {
    const id = "0b1c2d3e-0000-4000-8000-0000000000cc"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ media: { deletedAt: "2026-01-01" } }), { status: 200 })),
    )
    const { DesignBlockView } = await import("../design-block")
    const props = {
      node: { attrs: { designId: "d", title: "T", thumbnailUrl: `/api/media/${id}` } },
      updateAttributes: vi.fn(),
      editor: { isEditable: true },
      selected: false,
      deleteNode: vi.fn(),
    } as unknown as Parameters<typeof DesignBlockView>[0]
    const { container } = render(<DesignBlockView {...props} />)
    expect(await screen.findByText("Cliquer pour ouvrir Studio")).toBeTruthy()
    expect(container.querySelector("img")).toBeNull()
  })
})
