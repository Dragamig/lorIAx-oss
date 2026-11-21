import { describe, it, expect, vi, beforeEach } from "vitest";

const sel: unknown[][] = [];
function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const k of ["from", "where", "innerJoin"]) c[k] = () => c;
  c.limit = () => Promise.resolve(result());
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(res, rej);
  return c;
}
const h = vi.hoisted(() => ({
  forMedia: vi.fn(),
  resolve: vi.fn(),
  docView: vi.fn(),
  spaceRead: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { select: () => chain(() => sel.shift() ?? []) } }));
vi.mock("@/lib/media/access", () => ({
  getMediaForAccess: h.forMedia,
  resolveMediaAccess: h.resolve,
}));
vi.mock("@/lib/media/list", () => ({ visibleMediaCondition: () => Promise.resolve({}) }));
vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: h.docView,
  checkSpaceReadAccess: h.spaceRead,
}));

import { getMediaUsages, summarizeUsages } from "./usage-links";

const U = { id: "u1" } as never;
const ORG = "org1";
const M1 = "11111111-1111-4111-8111-111111111111";
const D1 = "d1";
const D2 = "d2";
const K1 = "k1";
const use = (targetType: string, targetId: string, mediaId = M1) => ({
  mediaId, targetType, targetId, context: null, source: "content", spaceId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  sel.length = 0;
  h.forMedia.mockResolvedValue({ id: M1, organizationId: ORG });
  h.resolve.mockResolvedValue({ allowed: true });
  h.docView.mockImplementation((_u, spaceId: string) => Promise.resolve(spaceId === "sOK"));
  h.spaceRead.mockResolvedValue(true);
});

describe("getMediaUsages", () => {
  it("filtre les cibles illisibles : titre absent, compté dans hiddenCount", async () => {
    sel.push(
      [use("document", D1), use("document", D2), use("brand_kit", K1)],
      [
        { id: D1, title: "Visible doc", spaceId: "sOK", spaceSlug: "ok", orgId: ORG },
        { id: D2, title: "Secret titre", spaceId: "sNO", spaceSlug: "no", orgId: ORG },
      ],
      [{ id: K1 }]
    );
    const r = await getMediaUsages(U, ORG, M1);
    expect(r!.entries).toHaveLength(2);
    expect(r!.hiddenCount).toBe(1);
    expect(r!.entries[0].href).toBe(`/s/ok/${D1}`);
    expect(JSON.stringify(r)).not.toContain("Secret titre");
    expect(JSON.stringify(r)).not.toContain("/s/no/");
  });
  it("document d'une autre organisation : masqué", async () => {
    sel.push([use("document", D1)], [{ id: D1, title: "Autre", spaceId: "sOK", spaceSlug: "x", orgId: "other" }]);
    const r = await getMediaUsages(U, ORG, M1);
    expect(r!.entries).toEqual([]);
    expect(r!.hiddenCount).toBe(1);
  });
  it("brand kit d'une autre organisation : masqué", async () => {
    sel.push([use("brand_kit", K1)], []);
    expect((await getMediaUsages(U, ORG, M1))!.hiddenCount).toBe(1);
  });
  it("design et projet vidéo : jugés sur l'espace de l'usage", async () => {
    h.spaceRead.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    sel.push([
      { ...use("design", "x1"), spaceId: "s1" },
      { ...use("video_project", "x2"), spaceId: "s2" },
      use("design", "x3"),
    ]);
    const r = await getMediaUsages(U, ORG, M1);
    expect(r!.entries).toHaveLength(1);
    expect(r!.hiddenCount).toBe(2);
  });
  it("média non lisible ou autre organisation : null", async () => {
    h.resolve.mockResolvedValueOnce({ allowed: false, reason: "space" });
    expect(await getMediaUsages(U, ORG, M1)).toBeNull();
    h.forMedia.mockResolvedValueOnce({ id: M1, organizationId: "other" });
    expect(await getMediaUsages(U, ORG, M1)).toBeNull();
    h.forMedia.mockResolvedValueOnce(null);
    expect(await getMediaUsages(U, ORG, M1)).toBeNull();
  });
  it("média en corbeille : usages toujours listés", async () => {
    h.forMedia.mockResolvedValue({ id: M1, organizationId: ORG, deletedAt: new Date() });
    sel.push([use("brand_kit", K1)], [{ id: K1 }]);
    expect((await getMediaUsages(U, ORG, M1))!.entries).toHaveLength(1);
  });
});

describe("summarizeUsages", () => {
  const ids = ["a", "b", "c", "d", "e"].map((x) => `${x.repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
  it("lot de 5 dont 2 utilisés", async () => {
    sel.push(
      ids.map((id) => ({ id })),
      [use("brand_kit", K1, ids[0]), use("brand_kit", K1, ids[1]), use("brand_kit", "k2", ids[1])],
      [{ id: K1 }]
    );
    const r = await summarizeUsages(U, ORG, ids);
    expect(r.usedCount).toBe(2);
    expect(r.perMedia[ids[1]]).toEqual({ total: 2, visible: 1, hidden: 1 });
    expect(r.perMedia[ids[2]]).toEqual({ total: 0, visible: 0, hidden: 0 });
  });
  it("médias illisibles absents de perMedia", async () => {
    sel.push([{ id: ids[0] }], []);
    const r = await summarizeUsages(U, ORG, ids);
    expect(Object.keys(r.perMedia)).toEqual([ids[0]]);
    expect(r.usedCount).toBe(0);
  });
  it("aucun id lisible : vide", async () => {
    sel.push([]);
    expect(await summarizeUsages(U, ORG, ids)).toEqual({ perMedia: {}, usedCount: 0 });
  });
});
