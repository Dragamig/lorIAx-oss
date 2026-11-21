import { describe, expect, it } from "vitest"
import { frameHeaderRules, isMediaReadPath } from "./frame-policy"
import { isInlineSafe } from "./kind"

const ID = "0b1c2d3e-0000-4000-8000-000000000000"

describe("frame-policy", () => {
  it("seule la lecture d'un média est encadrable", () => {
    expect(isMediaReadPath(`/api/media/${ID}`)).toBe(true)
    for (const p of [`/api/media/${ID}/meta`, `/api/media/${ID}/`, "/api/media/x", `/api/attachments/${ID}`, "/api/media", `/fr/api/media/${ID}`]) {
      expect(isMediaReadPath(p)).toBe(false)
    }
  })

  it("X-Frame-Options : SAMEORIGIN pour la lecture d'un média, DENY ailleurs", () => {
    const [media, rest] = frameHeaderRules()
    expect(media.headers).toEqual([{ key: "X-Frame-Options", value: "SAMEORIGIN" }])
    expect(rest.headers).toEqual([{ key: "X-Frame-Options", value: "DENY" }])
    expect(media.source).toContain("/api/media/")
  })

  it("un PDF est servi inline, SVG et HTML restent en pièce jointe", () => {
    expect(isInlineSafe("application/pdf")).toBe(true)
    expect(isInlineSafe("image/svg+xml")).toBe(false)
    expect(isInlineSafe("text/html")).toBe(false)
  })
})
