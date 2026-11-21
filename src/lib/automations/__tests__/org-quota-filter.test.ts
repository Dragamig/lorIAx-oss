import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@/lib/db", () => ({ db: {} }));

import { orgQuotaSourceFilter } from "../executor";

describe("quota horaire d'organisation", () => {
  it("exclut les runs source = import du décompte", () => {
    const { sql: text } = new PgDialect().sqlToQuery(orgQuotaSourceFilter());
    expect(text).toContain('"source"');
    expect(text).toContain("<> 'import'");
  });
});
