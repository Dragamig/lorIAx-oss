import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { state } = vi.hoisted(() => ({ state: { where: null as unknown, rows: [] as unknown[], calls: 0 } }));

vi.mock("@/lib/db", () => {
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.innerJoin = () => c;
  c.where = (w: unknown) => {
    state.where = w;
    state.calls++;
    return Promise.resolve(state.rows);
  };
  return { db: { select: () => c } };
});

import { createOrgKeyLookup } from "./attachment-key-lookup";

const render = () => {
  const q = new PgDialect().sqlToQuery(state.where as never);
  return { sql: q.sql, params: q.params };
};

describe("createOrgKeyLookup", () => {
  it("exclut les médias supprimés, filtre par organisation et par espace, une seule requête", async () => {
    state.rows = [{ id: "m1", storageKey: "a" }];
    const lookup = createOrgKeyLookup("org-1", "space-1");
    const r = await lookup(["a", "b"]);
    expect(state.calls).toBe(1);
    const { sql, params } = render();
    expect(sql).toMatch(/"deleted_at" is null/);
    expect(sql).toMatch(/"storage_key" in/);
    expect(sql).toMatch(/"space_id" = /);
    expect(sql).toMatch(/"type" = /);
    expect(params).toEqual(expect.arrayContaining(["org-1", "space-1", "a", "b", "organization", "secret"]));
    expect(r.get("a")).toEqual({ status: "found", id: "m1" });
    expect(r.get("b")).toEqual({ status: "missing" });
  });

  it("deux lignes pour une clé : ambiguë", async () => {
    state.rows = [{ id: "m1", storageKey: "a" }, { id: "m2", storageKey: "a" }];
    const r = await createOrgKeyLookup("o", "s")(["a"]);
    expect(r.get("a")).toEqual({ status: "ambiguous" });
  });
});
