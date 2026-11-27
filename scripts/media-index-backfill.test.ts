import { describe, it, expect, vi } from "vitest";
import { backfillMediaIndex, parseArgs } from "./media-index-backfill";

const row = (id: string, org: string, enabled: boolean, mime = "application/pdf", filename = `${id}.pdf`) => ({
  id,
  organization_id: org,
  mime_type: mime,
  filename,
  enabled,
});

function mk(rows: ReturnType<typeof row>[]) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const enqueue = vi.fn(async () => undefined);
  const deps = {
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows };
      }),
    } as never,
    enqueue,
  };
  return { deps, enqueue, queries };
}

describe("backfillMediaIndex", () => {
  it("dry-run : rapport par organisation, aucune mise en file, une seule requête SELECT", async () => {
    const { deps, enqueue, queries } = mk([row("a", "o1", true), row("b", "o1", true), row("c", "o2", false)]);
    const r = await backfillMediaIndex({ apply: false }, deps);
    expect(enqueue).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
    expect(queries[0].sql.startsWith("select")).toBe(true);
    expect(r.orgs).toEqual({
      o1: { enabled: true, candidates: 2, enqueued: 0 },
      o2: { enabled: false, candidates: 1, enqueued: 0 },
    });
    expect(r.enqueued).toBe(0);
  });

  it("apply : seules les organisations activées sont mises en file", async () => {
    const { deps, enqueue } = mk([row("a", "o1", true), row("c", "o2", false)]);
    const r = await backfillMediaIndex({ apply: true }, deps);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith("a", "backfill");
    expect(r.orgs.o2).toEqual({ enabled: false, candidates: 1, enqueued: 0 });
  });

  it("--limit est respecté", async () => {
    const { deps, enqueue } = mk([row("a", "o1", true), row("b", "o1", true), row("c", "o1", true)]);
    const r = await backfillMediaIndex({ apply: true, limit: 2 }, deps);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(r.enqueued).toBe(2);
  });

  it("les types sans extracteur sont ignorés", async () => {
    const { deps, enqueue } = mk([row("z", "o1", true, "application/zip", "z.zip"), row("a", "o1", true)]);
    const r = await backfillMediaIndex({ apply: true }, deps);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(r.candidates).toBe(1);
  });

  it("--org passe l'organisation en paramètre SQL ; la requête exclut la corbeille", async () => {
    const { deps, queries } = mk([]);
    await backfillMediaIndex({ apply: false, orgId: "o9" }, deps);
    expect(queries[0].params).toEqual(["o9"]);
    expect(queries[0].sql).toContain("m.deleted_at is null");
  });

  it("parseArgs", () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(["--apply", "--limit", "5", "--org", "x"])).toEqual({ apply: true, limit: 5, orgId: "x" });
  });
});
