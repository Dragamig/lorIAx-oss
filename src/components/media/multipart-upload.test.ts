import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  backoffMs,
  discardLargeUpload,
  fingerprint,
  listStoredSessions,
  missingParts,
  uploadLargeFile,
  type LargeDeps,
  type PartPutResult,
} from "./multipart-upload"

const PART = 10
const cfg = { enabled: true, thresholdBytes: 5, partSize: PART, maxBytes: 1000 }

function memStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
    m,
  }
}

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const fileOf = (size: number) => new File([new Uint8Array(size)], "v.mp4", { type: "video/mp4", lastModified: 42 })

type Routes = {
  state?: { status: number; done?: { partNumber: number; etag: string }[] }
  open?: number
  complete?: number
  /** Statuts successifs de `complete` (le dernier se répète) ; `0` = coupure réseau. */
  completeSeq?: number[]
  /** Réponses successives de GET [id] une fois `complete` appelé (la dernière se répète). */
  afterComplete?: { status: number; body?: unknown }[]
  config?: typeof cfg
}

function setup(routes: Routes = {}) {
  const calls: string[] = []
  const signedBatches: number[][] = []
  let completeCalls = 0
  let afterCalls = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    calls.push(`${method} ${url}`)
    if (url === "/api/media/multipart/config") return res(200, routes.config ?? cfg)
    if (url === "/api/media/multipart" && method === "POST") {
      return routes.open && routes.open !== 201
        ? res(routes.open, { error: "x" })
        : res(201, { uploadId: "up-1", partSize: PART, partCount: 5 })
    }
    if (/\/parts$/.test(url)) {
      const nums = JSON.parse(String(init!.body)).partNumbers as number[]
      signedBatches.push(nums)
      return res(200, { parts: nums.map((n) => ({ partNumber: n, url: `https://s3/p${n}` })) })
    }
    if (/\/complete$/.test(url)) {
      completeCalls++
      if (routes.completeSeq) {
        const st = routes.completeSeq[Math.min(completeCalls - 1, routes.completeSeq.length - 1)]
        if (st === 0) throw new TypeError("network")
        return st === 200 ? res(200, { media: { id: "m1" } }) : res(st, {})
      }
      return routes.complete && routes.complete !== 200 ? res(routes.complete, {}) : res(200, { media: { id: "m1" } })
    }
    if (method === "DELETE") return res(204)
    if (method === "GET" && completeCalls > 0 && routes.afterComplete) {
      const a = routes.afterComplete[Math.min(afterCalls++, routes.afterComplete.length - 1)]
      return res(a.status, a.body ?? {})
    }
    if (method === "GET") {
      const s = routes.state ?? { status: 404 }
      return s.status === 200 ? res(200, { partSize: PART, partCount: 5, done: s.done ?? [] }) : res(s.status, {})
    }
    return res(500)
  })
  return { fetchMock, calls, signedBatches }
}

const hooksOf = (signal = new AbortController().signal) => ({ onProgress: vi.fn(), signal, onPart: vi.fn(), onRetry: vi.fn(), onVerify: vi.fn() })
const okPut = (n = { max: 0, cur: 0 }) =>
  vi.fn(async (_u: string, _b: Blob, _s: AbortSignal, onP: (l: number) => void): Promise<PartPutResult> => {
    n.cur++
    n.max = Math.max(n.max, n.cur)
    onP(5)
    await Promise.resolve()
    n.cur--
    return { status: 200, etag: '"e"' }
  })
let storage: ReturnType<typeof memStorage>
const sleep = vi.fn(async () => {})
beforeEach(() => {
  storage = memStorage()
  sleep.mockClear()
})
const depsOf = (f: ReturnType<typeof setup>, putPart: LargeDeps["putPart"]): LargeDeps => ({
  userId: "u1",
  fetch: f.fetchMock as unknown as typeof fetch,
  putPart,
  sleep,
  storage,
})

describe("fonctions pures", () => {
  it("empreinte et parts manquantes", () => {
    expect(fingerprint("u", { name: "a", size: 2, lastModified: 3 })).toBe("u:a:2:3")
    expect(missingParts(5, [{ partNumber: 2 }, { partNumber: 4 }])).toEqual([1, 3, 5])
  })
  it("délai croissant", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([2000, 4000, 8000])
  })
})

describe("uploadLargeFile", () => {
  it("envoie 3 parts en parallèle, lit l'ETag, signe par lots, progression monotone", async () => {
    const f = setup()
    const n = { max: 0, cur: 0 }
    const h = hooksOf()
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, h, depsOf(f, okPut(n)))
    expect(r).toEqual({ ok: true, mediaId: "m1" })
    expect(n.max).toBe(3)
    const progress = h.onProgress.mock.calls.map((c) => c[0] as number)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(progress.at(-1)).toBe(45)
    expect(f.signedBatches.flat().sort()).toEqual([1, 2, 3, 4, 5])
    expect(h.onVerify).toHaveBeenCalled()
    const complete = f.fetchMock.mock.calls.find((c) => /complete$/.test(c[0] as string))!
    expect(JSON.parse(String(complete[1]!.body)).parts).toHaveLength(5)
    expect(storage.m.size).toBe(0)
  })

  it("les tags sont transmis à l'ouverture", async () => {
    const f = setup()
    await uploadLargeFile(fileOf(45), { spaceId: "s", tags: ["pub"] }, hooksOf(), depsOf(f, okPut()))
    const open = f.fetchMock.mock.calls.find((c) => c[0] === "/api/media/multipart" && c[1]?.method === "POST")!
    expect(JSON.parse(String(open[1]!.body)).tags).toEqual(["pub"])
  })

  it("reprise : n'envoie que les parts manquantes d'après GET [id]", async () => {
    const f = setup({ state: { status: 200, done: [1, 2, 3].map((n) => ({ partNumber: n, etag: `"o${n}"` })) } })
    storage.setItem(
      "loriax:media-multipart:u1:v.mp4:45:42",
      JSON.stringify({ uploadId: "up-1", name: "v.mp4", size: 45, lastModified: 42, type: "video/mp4", partCount: 5, partsDone: 3, target: { spaceId: "s" }, savedAt: Date.now() }),
    )
    const put = okPut()
    const h = hooksOf()
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, h, depsOf(f, put))
    expect(r.ok).toBe(true)
    expect(h.onProgress.mock.calls[0]).toEqual([30, 45])
    expect(h.onPart.mock.calls[0]).toEqual([3, 5])
    expect(put).toHaveBeenCalledTimes(2)
    expect(f.calls).not.toContain("POST /api/media/multipart")
    const complete = f.fetchMock.mock.calls.find((c) => /complete$/.test(c[0] as string))!
    expect(JSON.parse(String(complete[1]!.body)).parts.map((p: { etag: string }) => p.etag)).toEqual(['"o1"', '"o2"', '"o3"', '"e"', '"e"'])
  })

  it("envoi expiré (404) : repart de zéro", async () => {
    const f = setup({ state: { status: 404 } })
    storage.setItem(
      "loriax:media-multipart:u1:v.mp4:45:42",
      JSON.stringify({ uploadId: "old", name: "v.mp4", size: 45, lastModified: 42, type: "video/mp4", partCount: 5, partsDone: 3, target: { spaceId: "s" }, savedAt: Date.now() }),
    )
    const put = okPut()
    await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), depsOf(f, put))
    expect(f.calls).toContain("POST /api/media/multipart")
    expect(put).toHaveBeenCalledTimes(5)
  })

  it("une part échouée est retentée 3 fois avec attente croissante puis l'envoi est interrompu, session conservée", async () => {
    const f = setup()
    const put = vi.fn(async (): Promise<PartPutResult> => {
      throw new Error("network")
    })
    const h = hooksOf()
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, h, depsOf(f, put))
    expect(r).toEqual({ ok: false, reason: "network" })
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual(expect.arrayContaining([2000, 4000, 8000]))
    expect(put.mock.calls.length).toBeLessThanOrEqual(3 * 4)
    expect(storage.m.size).toBe(1)
    expect(f.calls.some((c) => c.startsWith("DELETE"))).toBe(false)
  })

  it("une part qui réussit au 2e essai ne fait pas échouer l'envoi", async () => {
    const f = setup()
    let first = true
    const put = vi.fn(async (_u: string, _b: Blob, _s: AbortSignal, onP: (l: number) => void): Promise<PartPutResult> => {
      if (first) {
        first = false
        throw new Error("network")
      }
      onP(5)
      return { status: 200, etag: '"e"' }
    })
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), depsOf(f, put))
    expect(r.ok).toBe(true)
  })

  it("annulation : DELETE de l'envoi et stockage nettoyé", async () => {
    const f = setup()
    const ac = new AbortController()
    const put = vi.fn(async (): Promise<PartPutResult> => {
      ac.abort("cancel")
      throw new DOMException("aborted", "AbortError")
    })
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(ac.signal), depsOf(f, put))
    expect(r).toEqual({ ok: false, reason: "aborted" })
    expect(f.calls).toContain("DELETE /api/media/multipart/up-1")
    expect(storage.m.size).toBe(0)
  })

  it("pause : abandon sans DELETE, session conservée", async () => {
    const f = setup()
    const ac = new AbortController()
    const put = vi.fn(async (): Promise<PartPutResult> => {
      ac.abort("pause")
      throw new DOMException("aborted", "AbortError")
    })
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(ac.signal), depsOf(f, put))
    expect(r).toEqual({ ok: false, reason: "aborted" })
    expect(f.calls.some((c) => c.startsWith("DELETE"))).toBe(false)
    expect(storage.m.size).toBe(1)
  })

  it("507 à l'ouverture : quota, aucune part envoyée", async () => {
    const f = setup({ open: 507 })
    const put = okPut()
    expect(await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), depsOf(f, put))).toEqual({ ok: false, reason: "quota" })
    expect(put).not.toHaveBeenCalled()
  })

  it("fonction désactivée et fichier trop gros", async () => {
    const off = setup({ config: { ...cfg, enabled: false } })
    expect(await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), depsOf(off, okPut()))).toEqual({ ok: false, reason: "disabled" })
    const small = setup({ config: { ...cfg, maxBytes: 10 } })
    expect(await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), depsOf(small, okPut()))).toEqual({ ok: false, reason: "too_large" })
  })

  it("finalisation refusée : invalide et session oubliée", async () => {
    const f = setup({ complete: 422 })
    expect(await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), depsOf(f, okPut()))).toEqual({ ok: false, reason: "invalid" })
    expect(storage.m.size).toBe(0)
  })

  describe("finalisation à l'issue incertaine", () => {
    const posts = (f: ReturnType<typeof setup>) => f.calls.filter((c) => c.endsWith("/complete")).length
    const run = (f: ReturnType<typeof setup>) => uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), depsOf(f, okPut()))

    it("504 sur complete : l'état est interrogé, le média terminé est rendu, aucune relance", async () => {
      const f = setup({ completeSeq: [504], afterComplete: [{ status: 200, body: { status: "completed", mediaId: "m9" } }] })
      expect(await run(f)).toEqual({ ok: true, mediaId: "m9" })
      expect(posts(f)).toBe(1)
      expect(storage.m.size).toBe(0)
    })

    it("en finalisation : attend puis rend le média ; 409 traité comme une issue incertaine", async () => {
      const f = setup({
        completeSeq: [409],
        afterComplete: [{ status: 200, body: { status: "completing" } }, { status: 200, body: { status: "completed", mediaId: "m9" } }],
      })
      expect(await run(f)).toEqual({ ok: true, mediaId: "m9" })
      expect(posts(f)).toBe(1)
      expect(sleep).toHaveBeenCalled()
    })

    it("coupure réseau puis envoi redevenu ouvert : complete est relancé", async () => {
      const f = setup({
        completeSeq: [0, 200],
        afterComplete: [{ status: 200, body: { status: "open", partSize: PART, partCount: 5, done: [] } }],
      })
      expect(await run(f)).toEqual({ ok: true, mediaId: "m1" })
      expect(posts(f)).toBe(2)
    })

    it("envoi introuvable après l'incident : échec, session oubliée", async () => {
      const f = setup({ completeSeq: [504], afterComplete: [{ status: 404 }] })
      expect(await run(f)).toEqual({ ok: false, reason: "invalid" })
      expect(storage.m.size).toBe(0)
    })
  })

  it("reprise d'un envoi déjà terminé côté serveur : média rendu sans rien renvoyer", async () => {
    const dep = depsOf(setup(), okPut())
    const fp = fingerprint("u1", { name: "v.mp4", size: 45, lastModified: 42 })
    storage.setItem(`loriax:media-multipart:${fp}`, JSON.stringify({ uploadId: "up-9", name: "v.mp4", size: 45, lastModified: 42, type: "video/mp4", partCount: 5, partsDone: 5, target: { spaceId: "s" }, savedAt: Date.now() }))
    const g = setup()
    const fetch2 = vi.fn(async (url: string, init?: RequestInit) =>
      /up-9$/.test(url) && !init?.method ? res(200, { status: "completed", mediaId: "m7" }) : g.fetchMock(url, init),
    )
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), { ...dep, fetch: fetch2 as unknown as typeof fetch })
    expect(r).toEqual({ ok: true, mediaId: "m7" })
    expect(storage.m.size).toBe(0)
  })

  it("stockage inaccessible : l'envoi aboutit quand même", async () => {
    const f = setup()
    const broken = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
      removeItem: () => {
        throw new Error("denied")
      },
      key: () => null,
      length: 0,
    }
    const r = await uploadLargeFile(fileOf(45), { spaceId: "s" }, hooksOf(), { ...depsOf(f, okPut()), storage: broken })
    expect(r.ok).toBe(true)
  })
})

describe("sessions mémorisées", () => {
  const sess = (savedAt: number, name = "a.mp4") => JSON.stringify({ uploadId: "x", name, size: 1, lastModified: 1, type: "video/mp4", partCount: 2, partsDone: 1, target: { spaceId: null }, savedAt })
  it("liste les envois de l'utilisateur et purge les expirés", () => {
    storage.setItem("loriax:media-multipart:u1:a.mp4:1:1", sess(Date.now()))
    storage.setItem("loriax:media-multipart:u1:old.mp4:1:1", sess(Date.now() - 25 * 3600_000, "old.mp4"))
    storage.setItem("loriax:media-multipart:u2:b.mp4:1:1", sess(Date.now(), "b.mp4"))
    const l = listStoredSessions({ userId: "u1", storage })
    expect(l.map((s) => s.name)).toEqual(["a.mp4"])
    expect(storage.getItem("loriax:media-multipart:u1:old.mp4:1:1")).toBeNull()
  })
  it("abandon : DELETE serveur et oubli local", async () => {
    storage.setItem("loriax:media-multipart:u1:a.mp4:1:1", sess(Date.now()))
    const f = setup()
    await discardLargeUpload({ name: "a.mp4", size: 1, lastModified: 1 }, { userId: "u1", storage, fetch: f.fetchMock as unknown as typeof fetch })
    expect(f.calls).toContain("DELETE /api/media/multipart/x")
    expect(storage.m.size).toBe(0)
  })
})
