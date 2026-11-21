/**
 * Garde de composition : le lien vers le studio video n'est emis que si le module studiovideo
 * fait partie de la composition (INCLUDED_MODULE_IDS). Dans l'edition oss, la route
 * /video-editor est elaguee : un lien serait mort.
 */
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

const ORG = "org1";
const M1 = "11111111-1111-4111-8111-111111111111";
const row = { mediaId: M1, targetType: "video_project", targetId: "p1", context: null, source: "content", spaceId: "s1" };

async function loadWith(ids: string[]) {
  vi.resetModules();
  vi.doMock("@/lib/modules/registry.generated", () => ({ INCLUDED_MODULE_IDS: ids }));
  vi.doMock("@/lib/db", () => ({ db: { select: () => chain(() => sel.shift() ?? []) } }));
  vi.doMock("@/lib/media/access", () => ({
    getMediaForAccess: vi.fn().mockResolvedValue({ id: M1, organizationId: ORG }),
    resolveMediaAccess: vi.fn().mockResolvedValue({ allowed: true }),
  }));
  vi.doMock("@/lib/media/list", () => ({ visibleMediaCondition: () => Promise.resolve({}) }));
  vi.doMock("@/lib/auth/check-access", () => ({
    checkDocumentViewAccess: vi.fn().mockResolvedValue(true),
    checkSpaceReadAccess: vi.fn().mockResolvedValue(true),
  }));
  return import("./usage-links");
}

beforeEach(() => {
  sel.length = 0;
  sel.push([row]);
});

describe("usage-links : garde INCLUDED_MODULE_IDS", () => {
  it("usage_links_emit_no_video_editor_href_when_studiovideo_is_not_included", async () => {
    const { getMediaUsages } = await loadWith(["studio", "crm"]);
    const r = await getMediaUsages({ id: "u1" } as never, ORG, M1);
    expect(JSON.stringify(r)).not.toContain("/video-editor");
    expect(r!.entries).toEqual([]);
    expect(r!.hiddenCount).toBe(1);
  });

  it("usage_links_emit_video_editor_href_when_studiovideo_is_included", async () => {
    const { getMediaUsages } = await loadWith(["studio", "studiovideo"]);
    const r = await getMediaUsages({ id: "u1" } as never, ORG, M1);
    expect(r!.entries.map((e) => e.href)).toEqual(["/video-editor/p1"]);
  });
});
