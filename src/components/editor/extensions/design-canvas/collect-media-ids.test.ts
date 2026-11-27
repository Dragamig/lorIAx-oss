import { describe, expect, it } from "vitest"
import { collectMediaIds } from "./collect-media-ids"

const A = "0b1c2d3e-0000-4000-8000-00000000000a"
const B = "0b1c2d3e-0000-4000-8000-00000000000b"

describe("collectMediaIds", () => {
  it("trouve les images de toutes les pages", () => {
    const doc = { pages: [{ json: { objects: [{ src: `/api/media/${A}` }] } }, { json: { objects: [{ src: `/api/studio/images/${B}` }] } }] }
    expect(collectMediaIds(doc).sort()).toEqual([A, B].sort())
  })
  it("ignore une URL externe et un data:", () => {
    const doc = { pages: [{ json: { objects: [{ src: `https://x.test/api/media/${A}` }, { src: "data:image/png;base64,AAA" }] } }] }
    expect(collectMediaIds(doc)).toEqual([])
  })
  it("dédoublonne", () => {
    const doc = { pages: [{ a: `/api/media/${A}`, b: `/api/media/${A.toUpperCase()}` }] }
    expect(collectMediaIds(doc)).toEqual([A])
  })
})
