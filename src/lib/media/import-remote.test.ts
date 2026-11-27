import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  ingest: vi.fn(),
  lookup: vi.fn(),
  fetch: vi.fn(),
  write: vi.fn(),
}))

vi.mock("@/lib/media/ingest", () => ({ ingestMedia: h.ingest }))
vi.mock("@/lib/media/folders", () => ({ canWriteLibrary: h.write }))
vi.mock("dns", () => ({
  promises: { lookup: h.lookup },
  default: { promises: { lookup: h.lookup } },
}))

import { importRemoteImage } from "./import-remote"

const user = { id: "u1" } as never
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)

function call(url: string, extra: Partial<Parameters<typeof importRemoteImage>[0]> = {}) {
  return importRemoteImage({ user, orgId: "o1", spaceId: "s1", url, origin: "upload", ...extra })
}

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset())
  h.lookup.mockResolvedValue([{ address: "203.0.113.34", family: 4 }])
  h.write.mockResolvedValue(true)
  h.ingest.mockResolvedValue({ ok: true, media: { id: "m1" }, quota: {}, hasLocationExif: false })
  vi.stubGlobal("fetch", h.fetch)
  h.fetch.mockImplementation(async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }))
})

describe("importRemoteImage, garde SSRF", () => {
  it.each([
    ["file:///etc/passwd"],
    ["ftp://example.com/a.png"],
    ["javascript:alert(1)"],
    ["data:image/png;base64,AAAA"],
    ["http://127.0.0.1/x.png"],
    ["http://localhost/x.png"],
    ["http://[::1]/x.png"],
    ["http://10.0.0.5/x.png"],
    ["http://192.168.1.2/x.png"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://metadata.google.internal/"],
    ["not a url"],
  ])("refuse %s en 400 sans aucune requête ni ligne", async (url) => {
    const res = await call(url)
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("refuse un nom qui résout vers une adresse privée", async () => {
    h.lookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }])
    const res = await call("https://evil.example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it("refuse une redirection vers une adresse interne", async () => {
    h.fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
    )
    const res = await call("https://example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("refuse plus de 3 redirections", async () => {
    h.fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://example.com/b.png" } }))
    const res = await call("https://example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("suit une redirection publique", async () => {
    h.fetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.example.com/b.png" } }))
      .mockResolvedValueOnce(new Response(PNG, { status: 200 }))
    const res = await call("https://example.com/a.png")
    expect(res.ok).toBe(true)
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })
})

describe("importRemoteImage, contenu", () => {
  it("coupe en 413 une réponse de plus de 50 Mo lue en flux", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024)
    let sent = 0
    const body = new ReadableStream({
      pull(controller) {
        sent++
        if (sent > 20) controller.close()
        else controller.enqueue(chunk)
      },
    })
    h.fetch.mockResolvedValue(new Response(body, { status: 200 }))
    const res = await call("https://example.com/big.png")
    expect(res).toMatchObject({ ok: false, status: 413 })
    expect(sent).toBeLessThan(10)
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("refuse en 413 un Content-Length annoncé trop grand", async () => {
    h.fetch.mockResolvedValue(new Response(PNG, { status: 200, headers: { "content-length": String(200 * 1024 * 1024) } }))
    const res = await call("https://example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 413 })
  })

  it("refuse en 415 du HTML servi comme image/png", async () => {
    h.fetch.mockResolvedValue(
      new Response("<html><script>1</script></html>", { status: 200, headers: { "content-type": "image/png" } })
    )
    const res = await call("https://example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 415 })
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("refuse un type réel non image (PDF) même sous extension .png", async () => {
    h.fetch.mockResolvedValue(new Response(Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj", "latin1"), { status: 200 }))
    const res = await call("https://example.com/a.png")
    expect(res.ok).toBe(false)
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("répond 400 sur une image distante en 404", async () => {
    h.fetch.mockResolvedValue(new Response("nope", { status: 404 }))
    const res = await call("https://example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("répond 400 sur une erreur réseau", async () => {
    h.fetch.mockRejectedValue(new TypeError("fetch failed"))
    const res = await call("https://example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 400 })
  })
})

describe("importRemoteImage, annulation par le client", () => {
  it("signal déjà annulé : aucune requête sortante ni ligne", async () => {
    const c = new AbortController()
    c.abort()
    const res = await call("https://a.b/c.png", { signal: c.signal })
    expect(res.ok).toBe(false)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("annulé pendant le téléchargement : pas d'ingestion", async () => {
    const c = new AbortController()
    h.fetch.mockImplementation(async () => {
      c.abort()
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })
    })
    const res = await call("https://a.b/c.png", { signal: c.signal })
    expect(res.ok).toBe(false)
    expect(h.ingest).not.toHaveBeenCalled()
  })
})

describe("importRemoteImage, ingestion", () => {
  it("ingère avec l'origine, le type détecté et un nom tiré de l'URL", async () => {
    const res = await call("https://images.unsplash.com/img/mon%20logo.jpg?x=1", { origin: "stock", displayName: "Photo" })
    expect(res.ok).toBe(true)
    const arg = h.ingest.mock.calls[0][0]
    expect(arg.origin).toBe("stock")
    expect(arg.spaceId).toBe("s1")
    expect(arg.displayName).toBe("Photo")
    expect(arg.file.type).toBe("image/png")
    expect(arg.file.name).toMatch(/^[^/\\]+\.png$/)
    expect(arg.file.name).toContain("logo")
  })

  it("répercute le quota atteint (507) sans toast de succès possible", async () => {
    h.ingest.mockResolvedValue({ ok: false, status: 507, error: "Quota atteint" })
    const res = await call("https://example.com/a.png")
    expect(res).toMatchObject({ ok: false, status: 507 })
  })

  it("sans espace : permis à un membre pour l'origine url comme pour la banque", async () => {
    expect((await call("https://example.com/a.png", { spaceId: null })).ok).toBe(true)
    expect((await call("https://images.unsplash.com/a.png", { spaceId: null, origin: "stock" })).ok).toBe(true)
    expect(h.ingest.mock.calls.at(-1)![0].spaceId).toBeNull()
  })
})

describe("importRemoteImage, origine et droits", () => {
  it("refuse l'origine stock pour un hôte hors banques d'images, sans requête", async () => {
    const res = await call("https://example.com/a.png", { spaceId: null, origin: "stock" })
    expect(res).toMatchObject({ ok: false, status: 400, error: "url_refused" })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("refuse un hôte qui ressemble à une banque d'images sans en être une", async () => {
    const res = await call("https://images.unsplash.com.evil.tld/a.png", { origin: "stock" })
    expect(res).toMatchObject({ ok: false, error: "url_refused" })
  })

  it("403 forbidden sans droit d'écriture dans la médiathèque, sans requête", async () => {
    h.write.mockResolvedValue(false)
    const res = await call("https://images.unsplash.com/a.png", { spaceId: null, origin: "stock" })
    expect(res).toMatchObject({ ok: false, status: 403, error: "forbidden" })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it("renvoie des codes stables, jamais du texte", async () => {
    h.fetch.mockResolvedValue(new Response("nope", { status: 404 }))
    expect(await call("https://example.com/a.png")).toMatchObject({ error: "remote_status" })
    h.fetch.mockResolvedValue(new Response(PNG, { status: 200, headers: { "content-length": String(200 * 1024 * 1024) } }))
    expect(await call("https://example.com/a.png")).toMatchObject({ error: "too_large" })
    h.fetch.mockResolvedValue(new Response("<html></html>", { status: 200 }))
    expect(await call("https://example.com/a.png")).toMatchObject({ error: "bad_type" })
  })
})
