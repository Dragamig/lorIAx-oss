import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ guard: vi.fn(), pub: vi.fn() }));
vi.mock("@/lib/storage/s3", () => ({
  BUCKET: "b",
  s3Client: {
    send: vi.fn(async (cmd: { constructor: { name: string } }) =>
      cmd.constructor.name === "HeadObjectCommand"
        ? { ContentLength: 3 }
        : { Body: { transformToWebStream: () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }) } },
    ),
  },
}));
vi.mock("@/lib/media/route-guard", () => ({ guardMediaRead: h.guard }));
vi.mock("@/lib/media/access", () => ({ resolvePublicMediaAccess: h.pub }));

import { GET as content } from "./route";
import { GET as thumb } from "./thumbnail/route";
import { GET as publicGet } from "../../public/[token]/media/[id]/route";

const ID = "11111111-1111-4111-8111-111111111111";
const base = {
  id: ID, storageKey: "k/a.png", thumbnailKey: "k/a.png.thumb.webp", mimeType: "image/png", filename: "a.png",
  currentVersion: 1, updatedAt: new Date(1000),
};
const replaced = { ...base, currentVersion: 2, storageKey: "k/b.png", updatedAt: new Date(2000) };
const ctx = { params: Promise.resolve({ id: ID }) };
const pctx = { params: Promise.resolve({ token: "t", id: ID }) };
const req = (inm?: string) => new Request("http://x", { headers: inm ? { "if-none-match": inm } : {} });

beforeEach(() => {
  h.guard.mockReset();
  h.pub.mockReset();
});

describe.each([
  ["contenu", (r: Request) => content(r, ctx)],
  ["miniature", (r: Request) => thumb(r, ctx)],
])("cache du %s", (_n, get) => {
  it("private, no-cache, avec ETag", async () => {
    h.guard.mockResolvedValue({ ok: true, row: base });
    const res = await get(req());
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toBeTruthy();
  });
  it("304 avec le même ETag, jamais avec l'ETag d'avant le remplacement", async () => {
    h.guard.mockResolvedValue({ ok: true, row: base });
    const oldEtag = (await get(req())).headers.get("etag")!;
    expect((await get(req(oldEtag))).status).toBe(304);

    h.guard.mockResolvedValue({ ok: true, row: replaced });
    const after = await get(req(oldEtag));
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(oldEtag);
  });
  it("l'ETag change même si updatedAt est identique mais la version diffère", async () => {
    h.guard.mockResolvedValue({ ok: true, row: base });
    const a = (await get(req())).headers.get("etag");
    h.guard.mockResolvedValue({ ok: true, row: { ...base, currentVersion: 2 } });
    expect((await get(req())).headers.get("etag")).not.toBe(a);
  });
});

describe("partage public", () => {
  it("garde public, no-cache et un ETag lié à la version", async () => {
    h.pub.mockResolvedValue({ allowed: true, row: base });
    const a = await publicGet(req(), pctx);
    expect(a.headers.get("cache-control")).toBe("public, no-cache");
    h.pub.mockResolvedValue({ allowed: true, row: replaced });
    const b = await publicGet(req(a.headers.get("etag")!), pctx);
    expect(b.status).toBe(200);
  });
});
