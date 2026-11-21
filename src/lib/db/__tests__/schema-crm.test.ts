import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { crmConnections } from "../schema-crm";

describe("schema-crm", () => {
  it("crm_connections expose exactement les colonnes de configuration", () => {
    const names = getTableConfig(crmConnections).columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "organization_id",
        "enabled",
        "contacts_database_id",
        "deals_database_id",
        "interactions_database_id",
        "created_database_ids",
        "field_map",
        "created_at",
        "updated_at",
        "updated_by",
      ].sort(),
    );
  });

  it("les trois FK de base sont en set null et celle d'organisation en cascade", () => {
    const fks = getTableConfig(crmConnections).foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [ref.columns[0].name, fk.onDelete] as const;
    });
    const byColumn = Object.fromEntries(fks);
    expect(byColumn.organization_id).toBe("cascade");
    expect(byColumn.contacts_database_id).toBe("set null");
    expect(byColumn.deals_database_id).toBe("set null");
    expect(byColumn.interactions_database_id).toBe("set null");
  });

  it("schema.ts réexporte schema-crm", () => {
    const text = readFileSync(join(__dirname, "..", "schema.ts"), "utf8");
    expect(text).toContain('export * from "./schema-crm"');
  });
});
