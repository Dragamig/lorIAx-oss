import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ results: [] as unknown[][], wheres: [] as unknown[] }));
vi.mock("@/lib/db", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.innerJoin = () => c;
    c.where = (w: unknown) => {
      h.wheres.push(w);
      return c;
    };
    c.limit = () => Promise.resolve(h.results.shift() ?? []);
    return c;
  };
  return { db: { select: () => chain() } };
});
vi.mock("@/lib/auth/check-access", () => ({ checkSpaceReadAccess: vi.fn(), checkSpaceWriteAccess: vi.fn() }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn() }));
vi.mock("@/lib/org/resolve-request-org", () => ({ isOrgMember: vi.fn() }));

import { getMediaByStorageKey } from "./access";

describe("getMediaByStorageKey", () => {
  it("résout une clé d'ancienne version (objet ou miniature) vers le média parent, corbeille comprise", async () => {
    const parent = { id: "m1", deletedAt: new Date(), spaceId: "s1" };
    h.results = [[], [parent]];
    const r = await getMediaByStorageKey("org/old-key.png");
    expect(r).toBe(parent);
    const q = new PgDialect().sqlToQuery(h.wheres[1] as never);
    expect(q.sql).toMatch(/"media_versions"."storage_key" = /);
    expect(q.sql).toMatch(/"media_versions"."thumbnail_key" = /);
  });

  it("clé inconnue : null", async () => {
    h.results = [[], []];
    expect(await getMediaByStorageKey("x/y")).toBeNull();
  });
});
