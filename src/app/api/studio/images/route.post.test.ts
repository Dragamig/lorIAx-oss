import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const h = vi.hoisted(() => ({ ingest: vi.fn(), dup: vi.fn() }))
vi.mock("@/lib/auth/require-org-scoped", () => ({
  OrgScopeError: class OrgScopeError extends Error {
    response = new Response(null, { status: 404 })
  },
  requireOrgScoped: vi.fn().mockResolvedValue({ user: { id: "u1", globalRole: "member" }, orgId: "org-1" }),
}))
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/images/validate-upload", () => ({
  validateImageUpload: vi.fn().mockResolvedValue({ ok: true, buffer: Buffer.from("png"), contentType: "image/png", ext: "png" }),
}))
vi.mock("@/lib/media/ingest", () => ({ ingestMedia: h.ingest }))
vi.mock("@/lib/media/duplicates", () => ({ findDuplicates: h.dup }))

import { POST } from "./route"

const ID = "11111111-1111-4111-8111-111111111111"
function req(kind?: string) {
  const fd = new FormData()
  fd.append("file", new File(["png"], "a.png", { type: "image/png" }))
  if (kind) fd.append("kind", kind)
  return new NextRequest("http://x/api/studio/images", { method: "POST", body: fd })
}
const row = {
  id: ID, filename: "a.png", storageKey: "k", mimeType: "image/png", sizeBytes: 3, organizationId: "org-1",
  spaceId: null, uploadedBy: "u1", createdAt: new Date(), updatedAt: new Date(),
}

beforeEach(() => {
  h.ingest.mockReset()
  h.dup.mockReset()
  h.ingest.mockResolvedValue({ ok: true, media: row })
  h.dup.mockResolvedValue({})
})

describe("POST /api/studio/images, design-export", () => {
  it("nouvel export : créé, duplicate false", async () => {
    const res = await POST(req("design-export"))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: ID, duplicate: false })
    expect(h.ingest).toHaveBeenCalledTimes(1)
  })
  it("export identique déjà présent : rien n'est créé, duplicate true", async () => {
    h.dup.mockImplementation(async (_u: unknown, _o: unknown, sums: string[]) => ({
      [sums[0]]: { id: ID, filename: "a.png", spaceName: null, thumbnailUrl: null },
    }))
    const res = await POST(req("design-export"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: ID, url: `/api/media/${ID}`, duplicate: true })
    expect(h.ingest).not.toHaveBeenCalled()
  })
  it("autre envoi : pas de recherche de doublon", async () => {
    await POST(req())
    expect(h.dup).not.toHaveBeenCalled()
  })
})
