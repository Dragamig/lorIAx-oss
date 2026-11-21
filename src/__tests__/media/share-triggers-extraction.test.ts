import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({ lectures: [] as unknown[][], order: [] as string[] }));

vi.mock("@/lib/db", () => {
  const chaine = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
      where: () => self,
      values: () => self,
      limit: () => Promise.resolve(h.lectures.shift() ?? []),
      returning: () => {
        h.order.push("insert");
        return Promise.resolve([{ id: "share-1", token: "jeton", createdAt: new Date() }]);
      },
    };
    return self;
  };
  return { db: { select: () => chaine(), insert: () => chaine() } };
});
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => ({ id: "u1", globalRole: "editor" })) }));
vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentEditAccess: vi.fn(async () => true),
  checkDocumentViewAccess: vi.fn(async () => true),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchWebhookEvent: vi.fn(),
  organizationIdOfSpace: vi.fn(async () => "org"),
}));
const logError = vi.fn();
vi.mock("@/lib/logger", () => ({ default: { error: (...a: unknown[]) => logError(...a), info: vi.fn(), warn: vi.fn() } }));
const syncDocumentUsages = vi.fn(async (_id: string) => {
  h.order.push("sync");
});
vi.mock("@/lib/media/usages", () => ({ syncDocumentUsages: (id: string) => syncDocumentUsages(id) }));

import { POST } from "@/app/api/documents/[id]/share/route";

const call = () =>
  POST(new NextRequest("http://x.test/api/documents/doc-1/share", { method: "POST" }), {
    params: Promise.resolve({ id: "doc-1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.order = [];
  h.lectures = [
    [{ id: "doc-1", spaceId: "s1", classification: "public" }],
    [{ id: "s1", classification: "public", organizationId: "org" }],
  ];
});

describe("création d'un partage public", () => {
  it("extrait les usages du document, après l'insertion et avant la réponse", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(syncDocumentUsages).toHaveBeenCalledWith("doc-1");
    expect(h.order).toEqual(["insert", "sync"]);
  });

  it("un échec d'extraction ne bloque pas le partage et est journalisé", async () => {
    syncDocumentUsages.mockRejectedValueOnce(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe("jeton");
    expect(logError).toHaveBeenCalled();
  });
});

describe("exigence B53", () => {
  it("markdown-sync.ts n'importe ni usage-sweep ni usages", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/collab/markdown-sync.ts"), "utf8");
    expect(src).not.toMatch(/usage-sweep/);
    expect(src).not.toMatch(/media\/usages/);
  });
});
