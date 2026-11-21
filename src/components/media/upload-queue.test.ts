import { describe, expect, it, vi } from "vitest"
import { createUploadQueue, type DuplicateInfo, type SendFn, type UploadItem } from "./upload-queue"

const target = { spaceId: "s1", folderId: null, tags: [] }
const file = (name: string, size = 100) => ({ name, size, type: "image/png" }) as unknown as File
const settle = async (q: ReturnType<typeof createUploadQueue>, pred: (s: UploadItem[]) => boolean) => {
  for (let i = 0; i < 500 && !pred(q.snapshot()); i++) await new Promise((r) => setTimeout(r, 0))
}
const idle = (s: UploadItem[]) => s.every((i) => !["queued", "hashing", "uploading"].includes(i.status))
const ok = (name: string): Promise<{ status: number; body: Record<string, unknown> }> =>
  Promise.resolve({ status: 201, body: { id: `id-${name}` } })
const hash = (f: File) => Promise.resolve(`sum-${f.name}`)
const noDups = () => Promise.resolve({})

describe("createUploadQueue", () => {
  it("100 fichiers : trop lourd, refusé 415 et doublon n'arrêtent pas les autres", async () => {
    const files = Array.from({ length: 100 }, (_, i) => file(`f${i}.png`))
    files[10] = file("big.png", 51 * 1024 * 1024)
    files[20] = file("virus.exe")
    const send: SendFn = (f) => (f.name === "virus.exe" ? Promise.resolve({ status: 415, body: {} }) : ok(f.name))
    const fetchDuplicates = vi.fn(async (sums: string[]): Promise<Record<string, DuplicateInfo>> =>
      sums.includes("sum-f30.png")
        ? { "sum-f30.png": { id: "old", filename: "f30.png", spaceName: "Direction", thumbnailUrl: null } }
        : {},
    )
    const q = createUploadQueue({ send, hash, fetchDuplicates })
    q.add(files, target)
    await settle(q, idle)
    const s = q.snapshot()
    expect(s.filter((i) => i.status === "done")).toHaveLength(97)
    const big = s.find((i) => i.name === "big.png")!
    expect(big.error).toEqual({ kind: "too_large", limitMb: 50 })
    const exe = s.find((i) => i.name === "virus.exe")!
    expect(exe.error).toEqual({ kind: "format", ext: ".exe" })
    q.retry(exe.id)
    expect(q.snapshot().find((i) => i.name === "virus.exe")!.status).toBe("error")
    expect(s.find((i) => i.name === "f30.png")!.status).toBe("duplicate")
    expect(Math.max(...fetchDuplicates.mock.calls.map((c) => c[0].length))).toBeLessThanOrEqual(20)
  })

  it("limite par type : 150 Mo de vidéo partent, 201 Mo non, 51 Mo d'image non", async () => {
    const send = vi.fn<SendFn>((f) => ok(f.name))
    const q = createUploadQueue({ send, hash, fetchDuplicates: noDups })
    const mb = 1024 * 1024
    const video = (name: string, size: number) => ({ name, size, type: "video/mp4" }) as unknown as File
    q.add([video("ok.mp4", 150 * mb), video("huge.mp4", 201 * mb), file("big.png", 51 * mb)], target)
    await settle(q, idle)
    const s = q.snapshot()
    expect(s.find((i) => i.name === "ok.mp4")!.status).toBe("done")
    expect(s.find((i) => i.name === "huge.mp4")!.error).toEqual({ kind: "too_large", limitMb: 200 })
    expect(s.find((i) => i.name === "big.png")!.error).toEqual({ kind: "too_large", limitMb: 50 })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("507 au 40e : les non commencés passent en quota, les 39 premiers restent done", async () => {
    let n = 0
    const send: SendFn = async (f) => {
      n++
      return n === 40 ? { status: 507, body: {} } : ok(f.name)
    }
    const q = createUploadQueue({ send, hash, fetchDuplicates: noDups, concurrency: 1 })
    q.add(Array.from({ length: 60 }, (_, i) => file(`f${i}.png`)), target)
    await settle(q, idle)
    const s = q.snapshot()
    expect(s.filter((i) => i.status === "done")).toHaveLength(39)
    const quota = s.filter((i) => i.error?.kind === "quota")
    expect(quota).toHaveLength(21)
    expect(quota[0].error).toEqual({ kind: "quota" })
  })

  it("erreur réseau : retry autorisé puis réussi", async () => {
    let calls = 0
    const send: SendFn = (f) => (++calls === 1 ? Promise.reject(new Error("net")) : ok(f.name))
    const q = createUploadQueue({ send, hash, fetchDuplicates: noDups })
    q.add([file("a.png")], target)
    await settle(q, idle)
    const it = q.snapshot()[0]
    expect(it.error?.kind).toBe("network")
    expect(it.error).toEqual({ kind: "network" })
    q.retry(it.id)
    await settle(q, idle)
    expect(q.snapshot()[0].status).toBe("done")
  })

  it("cancel en cours abandonne la requête sans erreur", async () => {
    let signal: AbortSignal | undefined
    const send: SendFn = (_f, _t, _p, s) => {
      signal = s
      return new Promise((_, reject) => s.addEventListener("abort", () => reject(new DOMException("a", "AbortError"))))
    }
    const q = createUploadQueue({ send, hash, fetchDuplicates: noDups })
    q.add([file("a.png")], target)
    await settle(q, (s) => s[0]?.status === "uploading")
    q.cancel(q.snapshot()[0].id)
    await settle(q, idle)
    expect(signal?.aborted).toBe(true)
    expect(q.snapshot()[0].status).toBe("cancelled")
    expect(q.snapshot()[0].error).toBeUndefined()
  })

  it("concurrence jamais supérieure à 3", async () => {
    let cur = 0
    let max = 0
    const send: SendFn = async (f) => {
      cur++
      max = Math.max(max, cur)
      await new Promise((r) => setTimeout(r, 1))
      cur--
      return ok(f.name)
    }
    const q = createUploadQueue({ send, hash, fetchDuplicates: noDups })
    q.add(Array.from({ length: 12 }, (_, i) => file(`f${i}.png`)), target)
    await settle(q, idle)
    expect(max).toBe(3)
    expect(q.snapshot().every((i) => i.status === "done")).toBe(true)
  })

  it("resolveDuplicate reuse n'envoie rien et expose le mediaId existant", async () => {
    const send = vi.fn<SendFn>((f) => ok(f.name))
    const dup = { id: "old", filename: "a.png", spaceName: "D", thumbnailUrl: null }
    const q = createUploadQueue({ send, hash, fetchDuplicates: async () => ({ "sum-a.png": dup }) })
    q.add([file("a.png")], target)
    await settle(q, (s) => s[0]?.status === "duplicate")
    q.resolveDuplicate(q.snapshot()[0].id, "reuse")
    expect(send).not.toHaveBeenCalled()
    expect(q.snapshot()[0]).toMatchObject({ status: "done", mediaId: "old", reused: true })
  })

  it("resolveDuplicate upload envoie le fichier", async () => {
    const send = vi.fn<SendFn>((f) => ok(f.name))
    const dup = { id: "old", filename: "a.png", spaceName: "D", thumbnailUrl: null }
    const q = createUploadQueue({ send, hash, fetchDuplicates: async () => ({ "sum-a.png": dup }) })
    q.add([file("a.png")], target)
    await settle(q, (s) => s[0]?.status === "duplicate")
    q.resolveDuplicate(q.snapshot()[0].id, "upload")
    await settle(q, idle)
    expect(send).toHaveBeenCalledTimes(1)
    expect(q.snapshot()[0].mediaId).toBe("id-a.png")
  })

  it("au-delà de 50 Mo : pas de hachage ni de test de doublon, envoi direct sans attendre le reste", async () => {
    const mb = 1024 * 1024
    const send = vi.fn<SendFn>((f) => ok(f.name))
    const hashFn = vi.fn((f: File) => (f.name === "slow.png" ? new Promise<string>(() => {}) : Promise.resolve(`sum-${f.name}`)))
    const fetchDuplicates = vi.fn(noDups)
    const q = createUploadQueue({ send, hash: hashFn, fetchDuplicates })
    const video = { name: "big.mp4", size: 150 * mb, type: "video/mp4" } as unknown as File
    q.add([file("slow.png"), video], target)
    await settle(q, (s) => s.find((i) => i.name === "big.mp4")?.status === "done")
    expect(q.snapshot().find((i) => i.name === "big.mp4")!.status).toBe("done")
    expect(hashFn.mock.calls.map((c) => c[0].name)).toEqual(["slow.png"])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("les fichiers hachés partent par lots de 20 sans attendre la fin du hachage", async () => {
    const send = vi.fn<SendFn>((f) => ok(f.name))
    const hashFn = (f: File) => (f.name === "f21.png" ? new Promise<string>(() => {}) : Promise.resolve(`sum-${f.name}`))
    const q = createUploadQueue({ send, hash: hashFn, fetchDuplicates: noDups })
    q.add(Array.from({ length: 25 }, (_, i) => file(`f${i}.png`)), target)
    await settle(q, (s) => s.filter((i) => i.status === "done").length >= 20)
    expect(q.snapshot().filter((i) => i.status === "done")).toHaveLength(20)
  })
})
