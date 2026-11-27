import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ ensure: vi.fn(), rows: [{ slug: "acme" }, { slug: "neuf" }], warn: vi.fn(), fail: false }))
vi.mock("@/lib/storage/s3", () => ({ ensureBucketCors: h.ensure }))
vi.mock("@/lib/logger", () => ({ default: { warn: h.warn } }))
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (h.fail) throw new Error("db")
          return h.rows
        },
      }),
    }),
  },
}))
vi.mock("@/lib/db/schema", () => ({ organizations: { slug: "slug", isActive: "is_active" } }))

import { syncBucketCors } from "./cors-sync"

beforeEach(() => {
  h.ensure.mockReset()
  h.warn.mockReset()
  h.fail = false
  vi.stubEnv("S3_ENDPOINT", "http://s3")
  vi.stubEnv("S3_PUBLIC_URL", "http://s3pub")
})

describe("syncBucketCors", () => {
  it("passe les slugs des organisations actives à la règle CORS", async () => {
    await syncBucketCors()
    expect(h.ensure).toHaveBeenCalledWith(["acme", "neuf"])
  })
  it("ne fait rien sans envoi direct configuré", async () => {
    vi.stubEnv("S3_PUBLIC_URL", "")
    await syncBucketCors()
    expect(h.ensure).not.toHaveBeenCalled()
  })
  it("erreur S3 ou base : journalisée, jamais propagée", async () => {
    h.ensure.mockRejectedValue(new Error("s3"))
    await expect(syncBucketCors()).resolves.toBeUndefined()
    h.fail = true
    await expect(syncBucketCors()).resolves.toBeUndefined()
    expect(h.warn).toHaveBeenCalledTimes(2)
  })
})
