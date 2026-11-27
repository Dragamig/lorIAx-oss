import { describe, expect, it } from "vitest"
import { mediaContentUrl, mediaThumbnailUrl, mediaVersionContentUrl } from "./urls"

describe("urls média", () => {
  it("la vignette porte la version courante", () => {
    expect(mediaThumbnailUrl({ id: "a", currentVersion: 3 })).toBe("/api/media/a/thumbnail?v=3")
  })
  it("le contenu courant porte la version courante", () => {
    expect(mediaContentUrl({ id: "a", currentVersion: 3 })).toBe("/api/media/a?v=3")
  })
  it("le contenu d'une version vise la route de version", () => {
    expect(mediaVersionContentUrl("a", 2)).toBe("/api/media/a/versions/2/content")
  })
})
