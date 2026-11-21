import { MAX_UPLOAD_BYTES, maxUploadBytesFor } from "@/lib/media/upload-limits"

export type UploadStatus = "queued" | "hashing" | "uploading" | "done" | "duplicate" | "error" | "cancelled"
export type UploadErrorKind = "format" | "too_large" | "network" | "quota" | "forbidden" | "server"

export const DUPLICATE_BATCH = 20
/** Au-delà, le fichier n'est pas haché (mémoire) : pas de test de doublon, envoi direct. */
export const HASH_MAX_BYTES = MAX_UPLOAD_BYTES

export type DuplicateInfo = { id: string; filename: string; spaceName: string; thumbnailUrl: string | null }

export type UploadItem = {
  id: string
  name: string
  size: number
  status: UploadStatus
  progress: number
  /** Données seules : le texte est traduit à l'affichage (upload-item-row). */
  error?: { kind: UploadErrorKind; limitMb?: number; ext?: string }
  mediaId?: string
  /** Média existant proposé en remplacement (statut duplicate). */
  duplicateOf?: DuplicateInfo
  /** Vrai quand le média existant a été réutilisé sans envoi. */
  reused?: boolean
}

export type UploadTarget = { spaceId: string | null; folderId: string | null; tags: string[] }

export type SendResult = { status: number; body: Record<string, unknown> }
export type SendFn = (
  file: File,
  target: UploadTarget,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
) => Promise<SendResult>

export type UploadQueueOptions = {
  concurrency?: number
  send?: SendFn
  hash?: (file: File) => Promise<string>
  fetchDuplicates?: (checksums: string[]) => Promise<Record<string, DuplicateInfo>>
}

export type UploadQueue = {
  add(files: File[], target: UploadTarget): void
  cancel(id: string): void
  retry(id: string): void
  resolveDuplicate(id: string, choice: "reuse" | "upload"): void
  clearFinished(): void
  subscribe(listener: () => void): () => void
  snapshot(): UploadItem[]
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(i) : ""
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

export const sendWithXhr: SendFn = (file, target, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const form = new FormData()
    form.append("file", file)
    if (target.spaceId) form.append("spaceId", target.spaceId)
    if (target.folderId) form.append("folderId", target.folderId)
    for (const t of target.tags) form.append("tags", t)
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/media")
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>
      } catch {
        /* corps non JSON */
      }
      resolve({ status: xhr.status, body })
    }
    xhr.onerror = () => reject(new Error("network"))
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"))
    signal.addEventListener("abort", () => xhr.abort())
    xhr.send(form)
  })

async function defaultFetchDuplicates(checksums: string[]): Promise<Record<string, DuplicateInfo>> {
  const res = await fetch("/api/media/duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checksums }),
  })
  if (!res.ok) return {}
  const data = (await res.json()) as { duplicates?: Record<string, DuplicateInfo> }
  return data.duplicates ?? {}
}

type Entry = { item: UploadItem; file: File; target: UploadTarget; controller?: AbortController }

export function createUploadQueue(opts: UploadQueueOptions = {}): UploadQueue {
  const concurrency = opts.concurrency ?? 3
  const send = opts.send ?? sendWithXhr
  const hash = opts.hash ?? sha256Hex
  const fetchDuplicates = opts.fetchDuplicates ?? defaultFetchDuplicates

  const entries: Entry[] = []
  const listeners = new Set<() => void>()
  let seq = 0
  let active = 0
  let quotaStop = false
  let cache: UploadItem[] = []

  const notify = () => {
    cache = entries.map((e) => ({ ...e.item }))
    listeners.forEach((l) => l())
  }

  const fail = (e: Entry, kind: UploadErrorKind, extra: { limitMb?: number; ext?: string } = {}) => {
    e.item = { ...e.item, status: "error", error: { kind, ...extra } }
  }
  const limitMbOf = (e: Entry) => Math.round(maxUploadBytesFor(e.file) / (1024 * 1024))

  const stopForQuota = () => {
    quotaStop = true
    for (const e of entries) if (e.item.status === "queued") fail(e, "quota")
  }

  const run = async (e: Entry) => {
    active++
    const controller = new AbortController()
    e.controller = controller
    e.item = { ...e.item, status: "uploading", progress: 0, error: undefined }
    notify()
    try {
      const res = await send(
        e.file,
        e.target,
        (r) => {
          if (e.item.status !== "uploading") return
          e.item = { ...e.item, progress: r }
          notify()
        },
        controller.signal,
      )
      if (e.item.status === "cancelled") return
      if (res.status >= 200 && res.status < 300) {
        e.item = { ...e.item, status: "done", progress: 1, mediaId: String(res.body.id ?? "") }
      } else if (res.status === 507) {
        fail(e, "quota")
        stopForQuota()
      } else if (res.status === 413) fail(e, "too_large", { limitMb: limitMbOf(e) })
      else if (res.status === 415 || res.status === 400) fail(e, "format", { ext: extensionOf(e.item.name) || undefined })
      else if (res.status === 403) fail(e, "forbidden")
      else fail(e, "server")
    } catch (err) {
      if (e.item.status === "cancelled") return
      if ((err as Error)?.name === "AbortError") e.item = { ...e.item, status: "cancelled" }
      else fail(e, "network")
    } finally {
      active--
      e.controller = undefined
      notify()
      pump()
    }
  }

  const pump = () => {
    while (active < concurrency) {
      const next = entries.find((e) => e.item.status === "queued")
      if (!next) return
      void run(next)
    }
  }

  const prepare = async (batch: Entry[]) => {
    const flush = async (chunk: { e: Entry; sum: string }[]) => {
      let dups: Record<string, DuplicateInfo> = {}
      try {
        dups = await fetchDuplicates([...new Set(chunk.map((c) => c.sum))])
      } catch {
        /* test de doublon indisponible : envoi direct */
      }
      for (const { e, sum } of chunk) {
        if (e.item.status !== "hashing") continue
        const d = dups[sum]
        e.item = d ? { ...e.item, status: "duplicate", duplicateOf: d } : { ...e.item, status: "queued" }
        if (quotaStop && e.item.status === "queued") fail(e, "quota")
      }
      notify()
      pump()
    }

    let chunk: { e: Entry; sum: string }[] = []
    for (const e of batch) {
      if (e.item.status !== "hashing") continue
      try {
        chunk.push({ e, sum: await hash(e.file) })
      } catch {
        /* sans somme : pas de test de doublon, envoi direct */
        if (e.item.status === "hashing") e.item = { ...e.item, status: "queued" }
        notify()
        pump()
      }
      if (chunk.length >= DUPLICATE_BATCH) {
        const full = chunk
        chunk = []
        await flush(full)
      }
    }
    if (chunk.length > 0) await flush(chunk)
    for (const e of batch) if (e.item.status === "hashing") e.item = { ...e.item, status: "queued" }
    notify()
    pump()
  }

  return {
    add(files, target) {
      quotaStop = false
      const batch: Entry[] = []
      for (const file of files) {
        const e: Entry = {
          file,
          target,
          item: { id: `u${++seq}`, name: file.name, size: file.size, status: "hashing", progress: 0 },
        }
        entries.push(e)
        if (file.size > maxUploadBytesFor(file)) fail(e, "too_large", { limitMb: limitMbOf(e) })
        else if (file.size > HASH_MAX_BYTES) e.item = { ...e.item, status: "queued" }
        else batch.push(e)
      }
      notify()
      pump()
      void prepare(batch)
    },
    cancel(id) {
      const e = entries.find((x) => x.item.id === id)
      if (!e || ["done", "error", "cancelled"].includes(e.item.status)) return
      e.item = { ...e.item, status: "cancelled" }
      e.controller?.abort()
      notify()
    },
    retry(id) {
      const e = entries.find((x) => x.item.id === id)
      if (!e || e.item.status !== "error" || e.item.error?.kind !== "network") return
      e.item = { ...e.item, status: "queued", error: undefined, progress: 0 }
      notify()
      pump()
    },
    resolveDuplicate(id, choice) {
      const e = entries.find((x) => x.item.id === id)
      if (!e || e.item.status !== "duplicate") return
      if (choice === "reuse") {
        e.item = { ...e.item, status: "done", progress: 1, reused: true, mediaId: e.item.duplicateOf?.id }
      } else {
        e.item = { ...e.item, status: "queued" }
      }
      notify()
      pump()
    },
    clearFinished() {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (["done", "error", "cancelled"].includes(entries[i].item.status)) entries.splice(i, 1)
      }
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => cache,
  }
}
