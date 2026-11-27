/**
 * I1 (revue finale, tache 40) : la purge de l'assistant ne doit pas effacer le
 * jeton d'amorcage, sans quoi un jeton neuf est engendre et l'assistant en cours
 * repond 401 a chaque etape suivante.
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ statements: [] as unknown[] }));

vi.mock("@/lib/db", () => {
  const tx = { execute: async (q: unknown) => void h.statements.push(q) };
  return { db: { transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) } };
});
vi.mock("@/lib/databases/row-change-context", () => ({
  setRowChangeContext: async () => {},
  SKIP_ROW_HISTORY: {},
}));

import { purgeAllData } from "@/lib/setup/purge";
import { SETUP_TOKEN_KEY } from "@/lib/setup/constants";

describe("purgeAllData", () => {
  it("conserve la ligne system_settings du jeton d'amorcage et setup_completed", async () => {
    await purgeAllData();
    const dialect = new PgDialect();
    const sqls = h.statements.map((q) => dialect.sqlToQuery(q as never));
    const del = sqls.find((s) => /DELETE FROM system_settings/.test(s.sql));
    expect(del).toBeDefined();
    const kept = [...del!.sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).concat(del!.params as string[]);
    expect(kept).toContain("setup_completed");
    expect(kept).toContain(SETUP_TOKEN_KEY);
  });

  it("conserve le marqueur de fermeture de l'inscription", async () => {
    h.statements.length = 0;
    await purgeAllData();
    const dialect = new PgDialect();
    const sqls = h.statements.map((q) => dialect.sqlToQuery(q as never));
    const del = sqls.find((s) => /DELETE FROM system_settings/.test(s.sql));
    const kept = [...del!.sql.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).concat(del!.params as string[]);
    expect(kept).toContain("oss_registration_closed_v2");
  });
});
