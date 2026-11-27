import { afterEach, describe, expect, it, vi } from "vitest"
import { saveExportToLibrary } from "./save-export-to-library"

afterEach(() => vi.unstubAllGlobals())
const blob = new Blob(["x"], { type: "image/png" })

describe("saveExportToLibrary", () => {
  it("envoie un FormData avec le nom et l'espace", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ id: "m1" }) }))
    vi.stubGlobal("fetch", f)
    const r = await saveExportToLibrary(blob, { name: "Affiche", spaceId: "sp1" })
    expect(r).toEqual({ id: "m1", duplicate: false })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/studio/images")
    const fd = init.body as FormData
    expect(fd.get("name")).toBe("Affiche")
    expect(fd.get("spaceId")).toBe("sp1")
    expect(fd.get("kind")).toBe("design-export")
  })
  it("rend duplicate true quand la réponse l'indique", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "m1", duplicate: true }) })))
    expect((await saveExportToLibrary(blob, { name: "A", spaceId: null })).duplicate).toBe(true)
  })
  it("lève une erreur sur réponse non ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 413, json: async () => ({}) })))
    await expect(saveExportToLibrary(blob, { name: "A", spaceId: null })).rejects.toThrow()
  })
})
