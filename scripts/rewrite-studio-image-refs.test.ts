import { describe, it, expect } from "vitest";
import { rewriteStudioImageRefs, type DesignStore, type Queryable } from "./rewrite-studio-image-refs";

const ID = "11111111-1111-4111-8111-111111111111";

function fakeDb() {
  const updates: { sql: string; params: unknown[] }[] = [];
  const state = { rowCount: 1 };
  const db: Queryable = {
    async query(sql, params) {
      if (sql.startsWith("UPDATE")) {
        updates.push({ sql, params: params ?? [] });
        return { rows: [], rowCount: state.rowCount };
      }
      if (sql.includes("FROM documents"))
        return { rows: [{ id: "d1", body: `![a](/api/studio/images/${ID})` }] };
      if (sql.includes("FROM brand_kits"))
        return { rows: [{ id: "b1", body: `[{"url":"/api/studio/images/${ID}"}]` }] };
      return { rows: [] };
    },
  };
  return { db, updates, state };
}

function fakeStore() {
  const written: string[] = [];
  const store: DesignStore = {
    list: async () => ["designs/a.json", "designs/b.json"],
    read: async (k) => (k === "designs/a.json" ? `{"src":"/api/studio/images/${ID}"}` : "{}"),
    write: async (k) => {
      written.push(k);
    },
  };
  return { store, written };
}

describe("rewriteStudioImageRefs", () => {
  it("dry-run : compte sans rien écrire", async () => {
    const { db, updates } = fakeDb();
    const { store, written } = fakeStore();
    const r = await rewriteStudioImageRefs(db, { apply: false, designs: store });
    expect(updates).toHaveLength(0);
    expect(written).toHaveLength(0);
    expect(r.counts.documents).toEqual({ scanned: 1, changed: 1, skipped: 0 });
    expect(r.counts.brand_kits.changed).toBe(1);
    expect(r.counts.s3_designs).toEqual({ scanned: 2, changed: 1, skipped: 0 });
  });

  it("apply : écrit les textes réécrits", async () => {
    const { db, updates } = fakeDb();
    const { store, written } = fakeStore();
    await rewriteStudioImageRefs(db, { apply: true, designs: store });
    expect(updates).toHaveLength(2);
    expect(updates[0].params[0]).toBe(`![a](/api/media/${ID})`);
    expect(updates[1].sql).toContain("::jsonb");
    expect(written).toEqual(["designs/a.json"]);
  });

  it("apply : l'UPDATE est conditionné à la valeur lue, les lignes modifiées entre-temps sont comptées", async () => {
    const { db, updates, state } = fakeDb();
    state.rowCount = 0;
    const r = await rewriteStudioImageRefs(db, { apply: true });
    expect(updates[0].sql).toMatch(/AND\s+content_text(::text)?\s*=\s*\$3/);
    expect(updates[0].params).toEqual([`![a](/api/media/${ID})`, "d1", `![a](/api/studio/images/${ID})`]);
    expect(r.counts.documents).toMatchObject({ changed: 1, skipped: 1 });
    expect(r.counts.brand_kits).toMatchObject({ skipped: 1 });
  });

  it("apply : aucune ligne sautée quand la valeur n'a pas bougé", async () => {
    const { db } = fakeDb();
    const r = await rewriteStudioImageRefs(db, { apply: true });
    expect(r.counts.documents.skipped).toBe(0);
  });
});
