import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const h = vi.hoisted(() => ({
  user: vi.fn(),
  org: vi.fn(),
  space: vi.fn(),
  imp: vi.fn(),
  detail: vi.fn(),
  rl: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: h.rl,
  RATE_LIMITS: { mediaImport: { maxRequests: 20, windowMs: 60000 } },
}))

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.user }))
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.org }))
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => h.space() }) }) }) },
}))
vi.mock("@/lib/media/import-remote", () => ({ importRemoteImage: h.imp }))
vi.mock("@/lib/media/metadata", () => ({ getMediaDetail: h.detail }))

import { POST } from "./route"

const SPACE = "11111111-1111-4111-8111-111111111111"
const req = (body: unknown) =>
  new NextRequest("http://x/api/media/import", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset())
  h.rl.mockResolvedValue({ success: true, remaining: 19, resetAt: Date.now() + 60000 })
  h.user.mockResolvedValue({ id: "u1" })
  h.org.mockResolvedValue("o1")
  h.space.mockResolvedValue([{ id: SPACE }])
  h.imp.mockResolvedValue({ ok: true, media: { id: "m1" } })
  h.detail.mockResolvedValue({ id: "m1" })
})

describe("POST /api/media/import", () => {
  it("401 sans session", async () => {
    h.user.mockResolvedValue(null)
    expect((await POST(req({ url: "https://a.b/c.png", origin: "upload" }))).status).toBe(401)
    expect(h.imp).not.toHaveBeenCalled()
  })

  it("400 sur un corps invalide ou une origine inconnue", async () => {
    expect((await POST(req("{"))).status).toBe(400)
    expect((await POST(req({ url: "https://a.b/c.png", origin: "automation" }))).status).toBe(400)
    expect((await POST(req({ url: "https://a.b/c.png", origin: "upload", spaceId: "zz" }))).status).toBe(400)
  })

  it("404 silencieux pour un espace d'une autre organisation", async () => {
    h.space.mockResolvedValue([])
    const res = await POST(req({ url: "https://a.b/c.png", origin: "upload", spaceId: SPACE }))
    expect(res.status).toBe(404)
    expect(h.imp).not.toHaveBeenCalled()
  })

  it("403 sans droit d'écriture (refus repris de l'ingestion)", async () => {
    h.imp.mockResolvedValue({ ok: false, status: 403, error: "Accès refusé à cet espace" })
    const res = await POST(req({ url: "https://a.b/c.png", origin: "upload", spaceId: SPACE }))
    expect(res.status).toBe(403)
  })

  it.each([400, 413, 415, 507])("répercute le statut %i", async (status) => {
    h.imp.mockResolvedValue({ ok: false, status, error: "x" })
    const res = await POST(req({ url: "https://a.b/c.png", origin: "stock", spaceId: SPACE }))
    expect(res.status).toBe(status)
    expect(h.detail).not.toHaveBeenCalled()
  })

  it("429 rate_limited au-delà de la limite par utilisateur, sans import", async () => {
    h.rl.mockResolvedValue({ success: false, remaining: 0, resetAt: Date.now() + 30000 })
    const res = await POST(req({ url: "https://a.b/c.png", origin: "upload", spaceId: SPACE }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "rate_limited" })
    expect(res.headers.get("Retry-After")).toBeTruthy()
    expect(h.rl).toHaveBeenCalledWith("media-import:u1", expect.anything())
    expect(h.imp).not.toHaveBeenCalled()
  })

  it("renvoie un code stable pour un refus de l'ingestion", async () => {
    h.imp.mockResolvedValue({ ok: false, status: 403, error: "Accès refusé à cet espace" })
    const res = await POST(req({ url: "https://a.b/c.png", origin: "upload", spaceId: SPACE }))
    expect(await res.json()).toEqual({ error: "forbidden" })
    h.imp.mockResolvedValue({ ok: false, status: 400, error: "url_refused" })
    const res2 = await POST(req({ url: "https://a.b/c.png", origin: "upload", spaceId: SPACE }))
    expect(await res2.json()).toEqual({ error: "url_refused" })
  })

  it("201 avec le média", async () => {
    const res = await POST(req({ url: "https://a.b/c.png", origin: "stock", spaceId: SPACE }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ media: { id: "m1" } })
    expect(h.imp).toHaveBeenCalledWith(expect.objectContaining({ orgId: "o1", spaceId: SPACE, origin: "stock" }))
  })

  it("transmet le signal d'annulation de la requête à l'import", async () => {
    await POST(req({ url: "https://a.b/c.png", origin: "stock", spaceId: SPACE }))
    expect(h.imp.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })

  it("requête annulée pendant l'import : pas de lecture du média, pas de 201", async () => {
    const c = new AbortController()
    const aborted = new NextRequest("http://x/api/media/import", {
      method: "POST",
      body: JSON.stringify({ url: "https://a.b/c.png", origin: "stock", spaceId: SPACE }),
      headers: { "content-type": "application/json" },
      signal: c.signal,
    })
    h.imp.mockImplementation(async () => {
      c.abort()
      return { ok: true, media: { id: "m1" } }
    })
    const res = await POST(aborted)
    expect(res.status).not.toBe(201)
  })
})
