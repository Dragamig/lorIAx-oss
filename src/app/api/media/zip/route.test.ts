import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  orgId: "org-1" as string | null,
  plan: null as unknown,
  planCalls: [] as unknown[],
  streams: [] as { stream: unknown; signal: AbortSignal }[],
  mode: "end" as "end" | "hang",
  logged: [] as { action: string; metadata: Record<string, unknown> }[],
  controllers: [] as { push: (c: Buffer | null) => void }[],
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.orgId) }));
vi.mock("@/lib/activity", () => ({
  logActivity: (a: { action: string; metadata: Record<string, unknown> }) => (h.logged.push(a), Promise.resolve()),
}));
vi.mock("@/lib/media/zip", () => ({
  planZip: (_u: unknown, orgId: string, source: unknown) => {
    h.planCalls.push({ orgId, source });
    return Promise.resolve(h.plan);
  },
  streamZip: (_plan: unknown, signal: AbortSignal) => {
    const r = new Readable({ read() {} });
    h.controllers.push({ push: (c) => r.push(c) });
    r.push(Buffer.from("PK-first"));
    if (h.mode === "end") r.push(null);
    signal.addEventListener("abort", () => r.destroy(), { once: true });
    h.streams.push({ stream: r, signal });
    return r;
  },
}));

import { GET } from "./route";
import { resetQuota } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const F = "33333333-3333-4333-8333-333333333333";
const okPlan = (skipped = 0) => ({
  ok: true,
  entries: [{ mediaId: A, storageKey: "k/a", path: "a.png", sizeBytes: 1 }],
  skipped,
  totalBytes: 1,
});
const req = (qs: string, signal?: AbortSignal) =>
  new Request(`http://x/api/media/zip?${qs}`, { signal }) as never;
let n = 0;

beforeEach(async () => {
  n++;
  h.user = { id: `user-${n}` };
  h.orgId = "org-1";
  h.plan = okPlan();
  h.planCalls = [];
  h.streams = [];
  h.controllers = [];
  h.logged = [];
  h.mode = "end";
  await resetQuota(`media-zip:user-${n}`, [RATE_LIMITS.mediaZip]);
});

async function drain(res: Response) {
  await res.arrayBuffer();
  await new Promise((r) => setTimeout(r, 10));
}

describe("GET /api/media/zip", () => {
  it("401 sans session", async () => {
    h.user = null;
    expect((await GET(req(`ids=${A}`))).status).toBe(401);
  });

  it("404 sans organisation", async () => {
    h.orgId = null;
    expect((await GET(req(`ids=${A}`))).status).toBe(404);
  });

  it("400 sans paramètre, avec un id invalide, avec les deux, ou plus de 200 ids", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("ids=pas-un-uuid"))).status).toBe(400);
    expect((await GET(req(`ids=${A}&folderId=${F}`))).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect((await GET(req(`ids=${many.join(",")}`))).status).toBe(400);
    expect(h.planCalls).toEqual([]);
  });

  it("200 zip en flux avec les en-têtes attendus et journal d'activité", async () => {
    h.plan = okPlan(2);
    const res = await GET(req(`ids=${A},${B}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; .*filename\*=UTF-8''.+\.zip$/);
    expect(res.headers.get("X-Zip-Skipped")).toBe("2");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("PK-first");
    expect(h.logged).toHaveLength(1);
    expect(h.logged[0].action).toBe("download");
    expect(h.logged[0].metadata).toMatchObject({ count: 1 });
  });

  it("l'organisation vient du serveur, jamais de la requête", async () => {
    const res = await GET(req(`ids=${A}&orgId=autre-org&organizationId=autre-org`));
    await drain(res);
    expect(h.planCalls).toEqual([{ orgId: "org-1", source: { ids: [A] } }]);
  });

  it("dossier : source folderId et nom d'archive du dossier", async () => {
    h.plan = {
      ok: true,
      entries: [{ mediaId: A, storageKey: "k/a", path: "Mes photos/a.png", sizeBytes: 1 }],
      skipped: 0,
      totalBytes: 1,
    };
    const res = await GET(req(`folderId=${F}`));
    expect(h.planCalls).toEqual([{ orgId: "org-1", source: { folderId: F } }]);
    expect(decodeURIComponent(res.headers.get("Content-Disposition")!)).toContain("Mes photos.zip");
    await drain(res);
  });

  it("relaie 404 (rien de lisible, sans détail) et 413", async () => {
    h.plan = { ok: false, status: 404, error: "Aucun fichier lisible" };
    expect((await GET(req(`ids=${A}`))).status).toBe(404);
    h.plan = { ok: false, status: 413, error: "Archive trop volumineuse" };
    const res = await GET(req(`ids=${A}`));
    expect(res.status).toBe(413);
    expect(h.streams).toEqual([]);
  });

  it("probe=1 : 204 sans flux ni consommation du quota, ou l'erreur JSON", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await GET(req(`ids=${A}&probe=1`));
      expect(r.status).toBe(204);
    }
    expect(h.streams).toEqual([]);
    expect(h.logged).toEqual([]);
    h.plan = { ok: false, status: 413, error: "Archive trop volumineuse" };
    const r = await GET(req(`ids=${A}&probe=1`));
    expect(r.status).toBe(413);
    expect((await r.json()).error).toBe("Archive trop volumineuse");
  });

  it("probe=1 : quota de débit propre, planZip non exécuté une fois épuisé", async () => {
    for (let i = 0; i < RATE_LIMITS.mediaZipProbe.maxRequests; i++) {
      expect((await GET(req(`ids=${A}&probe=1`))).status).toBe(204);
    }
    h.planCalls = [];
    const r = await GET(req(`ids=${A}&probe=1`));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(h.planCalls).toEqual([]);
  });

  it("429 à la 4e archive en 10 minutes, avec Retry-After", async () => {
    for (let i = 0; i < 3; i++) await drain(await GET(req(`ids=${A}`)));
    const res = await GET(req(`ids=${A}`));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const probe = await GET(req(`ids=${A}&probe=1`));
    expect(probe.status).toBe(429);
  });

  it("429 si une archive de l'utilisateur est en cours ; créneau libéré à la fin", async () => {
    h.mode = "hang";
    const first = await GET(req(`ids=${A}`));
    expect(first.status).toBe(200);
    const second = await GET(req(`ids=${A}`));
    expect(second.status).toBe(429);
    h.controllers[0].push(null);
    await drain(first);
    const third = await GET(req(`ids=${A}`));
    expect(third.status).toBe(200);
    h.controllers[1].push(null);
    await drain(third);
  });

  it("une archive plus longue que la fenêtre ne libère pas le créneau repris par une autre", async () => {
    h.mode = "hang";
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const first = await GET(req(`ids=${A}`));
      expect(first.status).toBe(200);
      vi.setSystemTime(Date.now() + 31 * 60 * 1000);
      const second = await GET(req(`ids=${A}`));
      expect(second.status).toBe(200);
      h.controllers[0].push(null);
      await drain(first);
      const third = await GET(req(`ids=${A}`));
      expect(third.status).toBe(429);
      h.controllers[1].push(null);
      await drain(second);
    } finally {
      vi.useRealTimers();
    }
  });

  it("créneau libéré quand le client abandonne", async () => {
    h.mode = "hang";
    const ac = new AbortController();
    const first = await GET(req(`ids=${A}`, ac.signal));
    const reader = first.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.cancel().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.streams[0].signal.aborted).toBe(true);
    const next = await GET(req(`ids=${A}`));
    expect(next.status).toBe(200);
    h.controllers[1].push(null);
    await drain(next);
  });

  it("le premier octet arrive avant la fin de la lecture S3", async () => {
    h.mode = "hang";
    const res = await GET(req(`ids=${A}`));
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(Buffer.from(first.value!).toString()).toBe("PK-first");
    expect(first.done).toBe(false);
    h.controllers[0].push(null);
    expect((await reader.read()).done).toBe(true);
  });
});
