import { describe, expect, it } from "vitest"
import { collectWhiteboardMediaIds } from "./whiteboard-media-ids"

const A = "0b1c2d3e-0000-4000-8000-00000000000a"
const B = "0b1c2d3e-0000-4000-8000-00000000000b"

describe("collectWhiteboardMediaIds", () => {
  it("ignore un élément isDeleted", () => {
    expect(collectWhiteboardMediaIds([{ type: "image", isDeleted: true, customData: { mediaId: A } }])).toEqual([])
  })
  it("dédoublonne", () => {
    const el = { type: "image", customData: { mediaId: A } }
    expect(collectWhiteboardMediaIds([el, el, { type: "image", customData: { mediaId: B } }])).toEqual([A, B])
  })
  it("ignore un élément sans customData ou non image", () => {
    expect(
      collectWhiteboardMediaIds([
        { type: "image" },
        { type: "image", customData: null },
        { type: "rectangle", customData: { mediaId: A } },
        { type: "image", customData: { mediaId: 3 } },
      ]),
    ).toEqual([])
  })
})
