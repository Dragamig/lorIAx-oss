/**
 * Envoi direct des grosses vidéos par parts signées, avec reprise.
 * Module sans DOM : `fetch`, l'envoi d'une part, l'attente et le stockage local
 * sont injectables, la logique de reprise et de nouvel essai se teste seule.
 */

export const PARALLEL_PARTS = 3
export const MAX_PART_RETRIES = 3
export const RETRY_BASE_MS = 2000
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const SIGN_BATCH = 20
/** Attente entre deux interrogations de l'état pendant la finalisation (SHA-256 d'un gros fichier). */
export const FINALIZE_POLL_MS = 3000
export const FINALIZE_MAX_POLLS = 200
const STORAGE_PREFIX = "loriax:media-multipart:"

export type LargeTarget = { spaceId: string | null; folderId?: string | null; tags?: string[] }
export type LargeFailure = "quota" | "too_large" | "disabled" | "aborted" | "network" | "invalid"
export type LargeResult = { ok: true; mediaId: string } | { ok: false; reason: LargeFailure }

export type MultipartConfig = { enabled: boolean; thresholdBytes: number; partSize: number; maxBytes: number }

export type LargeHooks = {
  onProgress(sent: number, total: number): void
  /** Annulation : `signal.reason === "cancel"` supprime l'envoi ; toute autre raison (pause) le conserve. */
  signal: AbortSignal
  onPart?(done: number, total: number): void
  /** Nouvel essai programmé (délai en ms) ; `null` quand il est levé. */
  onRetry?(info: { attempt: number; delayMs: number } | null): void
  /** Assemblage et vérification côté serveur. */
  onVerify?(): void
}

export type PartPutResult = { status: number; etag: string | null }

export type LargeDeps = {
  userId?: string
  fetch?: typeof fetch
  putPart?: (url: string, blob: Blob, signal: AbortSignal, onProgress: (loaded: number) => void) => Promise<PartPutResult>
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null
  now?: () => number
}

export type StoredSession = {
  uploadId: string
  name: string
  size: number
  lastModified: number
  type: string
  partCount: number
  partsDone: number
  target: LargeTarget
  savedAt: number
}

/** Délai croissant : 2 s, 4 s, 8 s (attempt compté depuis 1). */
export const backoffMs = (attempt: number) => RETRY_BASE_MS * 2 ** (attempt - 1)

export const fingerprint = (userId: string, f: { name: string; size: number; lastModified: number }) =>
  `${userId}:${f.name}:${f.size}:${f.lastModified}`

export function missingParts(partCount: number, done: { partNumber: number }[]): number[] {
  const have = new Set(done.map((d) => d.partNumber))
  const out: number[] = []
  for (let n = 1; n <= partCount; n++) if (!have.has(n)) out.push(n)
  return out
}

function defaultStorage(): LargeDeps["storage"] {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

const storageKey = (fp: string) => `${STORAGE_PREFIX}${fp}`

function loadSession(deps: LargeDeps, fp: string): StoredSession | null {
  const st = deps.storage === undefined ? defaultStorage() : deps.storage
  if (!st) return null
  try {
    const raw = st.getItem(storageKey(fp))
    if (!raw) return null
    const s = JSON.parse(raw) as StoredSession
    if (typeof s.uploadId !== "string" || (deps.now ?? Date.now)() - s.savedAt > SESSION_TTL_MS) {
      st.removeItem(storageKey(fp))
      return null
    }
    return s
  } catch {
    return null
  }
}

function saveSession(deps: LargeDeps, fp: string, s: StoredSession): void {
  const st = deps.storage === undefined ? defaultStorage() : deps.storage
  try {
    st?.setItem(storageKey(fp), JSON.stringify(s))
  } catch {
    /* stockage indisponible : pas de reprise après rechargement, l'envoi continue */
  }
}

export function clearSession(deps: LargeDeps, fp: string): void {
  const st = deps.storage === undefined ? defaultStorage() : deps.storage
  try {
    st?.removeItem(storageKey(fp))
  } catch {
    /* ignoré */
  }
}

/** Envois interrompus de l'utilisateur, non expirés (les expirés sont purgés). */
export function listStoredSessions(deps: LargeDeps): StoredSession[] {
  const st = deps.storage === undefined ? defaultStorage() : deps.storage
  if (!st || !deps.userId) return []
  const out: StoredSession[] = []
  try {
    const prefix = `${STORAGE_PREFIX}${deps.userId}:`
    const keys: string[] = []
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i)
      if (k && k.startsWith(prefix)) keys.push(k)
    }
    for (const k of keys) {
      const s = loadSession(deps, k.slice(STORAGE_PREFIX.length))
      if (s) out.push(s)
    }
  } catch {
    /* ignoré */
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

export async function fetchMultipartConfig(f: typeof fetch = fetch): Promise<MultipartConfig | null> {
  try {
    const res = await f("/api/media/multipart/config")
    if (!res.ok) return null
    return (await res.json()) as MultipartConfig
  } catch {
    return null
  }
}

/** Supprime côté serveur l'envoi mémorisé pour ce fichier puis l'oublie (abandon). */
export async function discardLargeUpload(
  file: { name: string; size: number; lastModified: number },
  deps: LargeDeps = {},
): Promise<void> {
  if (!deps.userId) return
  const fp = fingerprint(deps.userId, file)
  const s = loadSession(deps, fp)
  clearSession(deps, fp)
  if (s) {
    try {
      await (deps.fetch ?? fetch)(`/api/media/multipart/${s.uploadId}`, { method: "DELETE" })
    } catch {
      /* l'envoi expire de lui-même côté serveur */
    }
  }
}

export const putPartXhr: NonNullable<LargeDeps["putPart"]> = (url, blob, signal, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => resolve({ status: xhr.status, etag: xhr.getResponseHeader("ETag") })
    xhr.onerror = () => reject(new Error("network"))
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"))
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"))
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(blob)
  })

const sleepDefault = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"))
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(id)
      reject(new DOMException("aborted", "AbortError"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })

const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError"

class Fail extends Error {
  constructor(readonly reason: LargeFailure) {
    super(reason)
  }
}

const isTransient = (status: number) => status === 429 || status === 500 || (status >= 502 && status <= 504)

function mapStatus(status: number): LargeFailure | null {
  if (status === 507) return "quota"
  if (status === 413) return "too_large"
  if (status === 400 || status === 404 || status === 415 || status === 422) return "invalid"
  return null
}

export async function uploadLargeFile(
  file: File,
  target: LargeTarget,
  hooks: LargeHooks,
  deps: LargeDeps = {},
): Promise<LargeResult> {
  const doFetch = deps.fetch ?? fetch
  const putPart = deps.putPart ?? putPartXhr
  const sleep = deps.sleep ?? sleepDefault
  const now = deps.now ?? Date.now
  const { signal } = hooks
  const fp = deps.userId ? fingerprint(deps.userId, file) : null
  let uploadId: string | null = null

  const json = async (path: string, init?: RequestInit) => {
    const res = await doFetch(path, init)
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      /* corps absent */
    }
    return { status: res.status, ok: res.ok, body }
  }
  const post = (path: string, body: unknown) =>
    json(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })

  /** Appel de contrôle avec nouveaux essais bornés sur coupure réseau ou 5xx / 429. */
  const control = async (run: () => ReturnType<typeof json>) => {
    for (let attempt = 1; ; attempt++) {
      let res: Awaited<ReturnType<typeof json>> | null = null
      try {
        res = await run()
      } catch (e) {
        if (isAbort(e)) throw e
      }
      if (res && !isTransient(res.status)) {
        hooks.onRetry?.(null)
        return res
      }
      if (attempt > MAX_PART_RETRIES) throw new Fail("network")
      const delayMs = backoffMs(attempt)
      hooks.onRetry?.({ attempt, delayMs })
      await sleep(delayMs, signal)
    }
  }

  /**
   * Finalisation : un 5xx, un 409 ou une coupure ne disent pas si le serveur a
   * assemblé le fichier (le proxy peut couper une finalisation longue alors qu'elle
   * se poursuit). On interroge donc l'état au lieu de relancer à l'aveugle :
   * terminé, on prend le média ; en cours, on attend ; redevenu ouvert, on relance.
   */
  const finalize = async (id: string, parts: { partNumber: number; etag: string }[]) => {
    for (let round = 0; round <= MAX_PART_RETRIES; round++) {
      let res: Awaited<ReturnType<typeof json>> | null = null
      try {
        res = await post(`/api/media/multipart/${id}/complete`, { parts })
      } catch (e) {
        if (isAbort(e)) throw e
      }
      if (res && !isTransient(res.status) && res.status !== 409) {
        hooks.onRetry?.(null)
        return res
      }
      for (let poll = 0; poll < FINALIZE_MAX_POLLS; poll++) {
        let st: Awaited<ReturnType<typeof json>> | null = null
        try {
          st = await json(`/api/media/multipart/${id}`, { signal })
        } catch (e) {
          if (isAbort(e)) throw e
        }
        if (st && st.status === 404) return st
        if (st?.ok) {
          if (st.body.status === "completed" && typeof st.body.mediaId === "string") {
            hooks.onRetry?.(null)
            return { ...st, body: { media: { id: st.body.mediaId } } }
          }
          if (st.body.status === "open") break
        }
        await sleep(FINALIZE_POLL_MS, signal)
      }
      if (round < MAX_PART_RETRIES) {
        const delayMs = backoffMs(round + 1)
        hooks.onRetry?.({ attempt: round + 1, delayMs })
        await sleep(delayMs, signal)
      }
    }
    throw new Fail("network")
  }

  try {
    const cfg = await fetchMultipartConfig(doFetch)
    if (!cfg?.enabled) return { ok: false, reason: "disabled" }
    if (file.size > cfg.maxBytes) return { ok: false, reason: "too_large" }

    // Reprise : état serveur de l'envoi mémorisé, sinon ouverture neuve.
    let partSize = cfg.partSize
    let partCount = 0
    let done = new Map<number, string>()
    const stored = fp ? loadSession(deps, fp) : null
    if (stored) {
      const st = await control(() => json(`/api/media/multipart/${stored.uploadId}`, { signal }))
      if (st.ok && st.body.status === "completed" && typeof st.body.mediaId === "string") {
        if (fp) clearSession(deps, fp)
        return { ok: true, mediaId: st.body.mediaId }
      }
      // Finalisation encore en cours côté serveur : la session est gardée, on réessaiera.
      if (st.ok && st.body.status === "completing") return { ok: false, reason: "network" }
      if (st.ok) {
        uploadId = stored.uploadId
        partSize = st.body.partSize as number
        partCount = st.body.partCount as number
        done = new Map((st.body.done as { partNumber: number; etag: string }[]).map((p) => [p.partNumber, p.etag]))
      } else if (fp) {
        clearSession(deps, fp)
      }
    }
    if (!uploadId) {
      const open = await control(() =>
        post("/api/media/multipart", {
          spaceId: target.spaceId,
          folderId: target.folderId ?? null,
          name: file.name,
          size: file.size,
          type: file.type,
          tags: target.tags ?? [],
        }),
      )
      if (!open.ok) return { ok: false, reason: mapStatus(open.status) ?? "invalid" }
      uploadId = open.body.uploadId as string
      partSize = open.body.partSize as number
      partCount = open.body.partCount as number
    }
    const id = uploadId

    const persist = () => {
      if (fp) {
        saveSession(deps, fp, {
          uploadId: id,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          type: file.type,
          partCount,
          partsDone: done.size,
          target,
          savedAt: now(),
        })
      }
    }
    persist()

    const sizeOf = (n: number) => Math.min(partSize, file.size - (n - 1) * partSize)
    let sent = 0
    for (const n of done.keys()) sent += sizeOf(n)
    const inFlight = new Map<number, number>()
    let high = 0
    const report = () => {
      let cur = sent
      for (const v of inFlight.values()) cur += v
      high = Math.max(high, Math.min(cur, file.size))
      hooks.onProgress(high, file.size)
    }
    report()
    hooks.onPart?.(done.size, partCount)

    const todo = missingParts(partCount, [...done.keys()].map((partNumber) => ({ partNumber })))
    const signed = new Map<number, Promise<string>>()
    const ensureSigned = (n: number): Promise<string> => {
      const have = signed.get(n)
      if (have) return have
      const batch = todo.filter((x) => x >= n && !signed.has(x)).slice(0, SIGN_BATCH)
      if (!batch.includes(n)) batch.unshift(n)
      const call = control(() => post(`/api/media/multipart/${id}/parts`, { partNumbers: batch })).then((r) => {
        if (!r.ok) throw new Fail(mapStatus(r.status) ?? "invalid")
        return new Map((r.body.parts as { partNumber: number; url: string }[]).map((p) => [p.partNumber, p.url]))
      })
      for (const x of batch) {
        signed.set(
          x,
          call.then((m) => {
            const u = m.get(x)
            if (!u) throw new Fail("invalid")
            return u
          }),
        )
      }
      return signed.get(n)!
    }

    const inner = new AbortController()
    const isig = inner.signal
    const uploadOne = async (n: number) => {
      const blob = file.slice((n - 1) * partSize, (n - 1) * partSize + sizeOf(n))
      for (let attempt = 1; ; attempt++) {
        try {
          const url = await ensureSigned(n)
          inFlight.set(n, 0)
          const r = await putPart(url, blob, isig, (loaded) => {
            inFlight.set(n, loaded)
            report()
          })
          if (r.status >= 200 && r.status < 300 && r.etag) {
            done.set(n, r.etag)
            inFlight.delete(n)
            sent += sizeOf(n)
            report()
            persist()
            hooks.onRetry?.(null)
            hooks.onPart?.(done.size, partCount)
            return
          }
          // URL expirée ou refusée : on re-signe au prochain essai.
          if (r.status === 403 || r.status === 400) signed.delete(n)
        } catch (e) {
          if (isAbort(e) || e instanceof Fail) throw e
        }
        inFlight.delete(n)
        report()
        if (attempt > MAX_PART_RETRIES) throw new Fail("network")
        const delayMs = backoffMs(attempt)
        hooks.onRetry?.({ attempt, delayMs })
        await sleep(delayMs, isig)
      }
    }

    let cursor = 0
    const worker = async () => {
      while (cursor < todo.length) {
        if (isig.aborted) throw new DOMException("aborted", "AbortError")
        await uploadOne(todo[cursor++])
      }
    }
    const onOuter = () => inner.abort()
    signal.addEventListener("abort", onOuter, { once: true })
    try {
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL_PARTS, todo.length) }, () =>
          worker().catch((e) => {
            inner.abort()
            throw e
          }),
        ),
      )
    } finally {
      signal.removeEventListener("abort", onOuter)
    }

    hooks.onVerify?.()
    const parts = [...done.entries()].sort((a, b) => a[0] - b[0]).map(([partNumber, etag]) => ({ partNumber, etag }))
    const fin = await finalize(id, parts)
    if (!fin.ok) {
      // L'envoi est clos côté serveur : plus de reprise possible.
      if (fp) clearSession(deps, fp)
      return { ok: false, reason: mapStatus(fin.status) ?? "invalid" }
    }
    if (fp) clearSession(deps, fp)
    const mediaId = (fin.body.media as { id?: string } | undefined)?.id
    return mediaId ? { ok: true, mediaId } : { ok: false, reason: "invalid" }
  } catch (e) {
    if (isAbort(e) || signal.aborted) {
      if (signal.reason === "cancel" && uploadId) {
        if (fp) clearSession(deps, fp)
        try {
          await doFetch(`/api/media/multipart/${uploadId}`, { method: "DELETE" })
        } catch {
          /* expire côté serveur */
        }
      }
      return { ok: false, reason: "aborted" }
    }
    if (e instanceof Fail) return { ok: false, reason: e.reason }
    return { ok: false, reason: "network" }
  }
}
