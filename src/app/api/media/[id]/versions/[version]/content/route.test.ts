import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ serve: vi.fn(), guard: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/media/serve", () => ({ serveMediaObject: h.serve }));
vi.mock("@/lib/media/route-guard", () => ({ guardMediaRead: h.guard }));
vi.mock("@/lib/media/versions", () => ({ listVersions: h.list }));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const row = { id: ID, organizationId: "org1", currentVersion: 4 };
const versions = [4, 3, 2, 1].map((n) => ({
  id: `vid-${n}`, version: n, storageKey: `k/v${n}.png`, mimeType: "image/png", filename: `v${n}.png`,
}));
const call = (version: string) =>
  GET(new Request("http://x"), { params: Promise.resolve({ id: ID, version }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.guard.mockResolvedValue({ ok: true, row });
  h.list.mockResolvedValue(versions);
  h.serve.mockResolvedValue(new Response("ok"));
});

describe("GET /api/media/[id]/versions/[version]/content", () => {
  it("renvoie le refus du garde (401, 404 autre organisation)", async () => {
    const res = new Response(null, { status: 404 });
    h.guard.mockResolvedValue({ ok: false, res });
    expect(await call("2")).toBe(res);
    expect(h.list).not.toHaveBeenCalled();
  });
  it("sert l'objet de la version 2 même si la courante est la 4", async () => {
    await call("2");
    const a = h.serve.mock.calls[0][0];
    expect(a.key).toBe("k/v2.png");
    expect(a.maxAgeSeconds).toBe(0);
    expect(a.revalidate).toBe(true);
    expect(h.list).toHaveBeenCalledWith(ID, "org1");
  });
  it("404 pour une version inexistante ou invalide", async () => {
    expect((await call("9")).status).toBe(404);
    expect((await call("x")).status).toBe(404);
    expect(h.serve).not.toHaveBeenCalled();
  });
});
