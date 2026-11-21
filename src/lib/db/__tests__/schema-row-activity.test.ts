import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { databaseRowChanges } from "../schema-row-activity";

describe("schema-row-activity", () => {
  it("database_row_changes expose les colonnes de la spec", () => {
    expect(Object.keys(getTableColumns(databaseRowChanges)).sort()).toEqual([
      "actorLabel",
      "actorUserId",
      "automationId",
      "batchId",
      "changes",
      "createdAt",
      "databaseId",
      "id",
      "kind",
      "rowId",
      "source",
    ]);
    const names = getTableConfig(databaseRowChanges).indexes.map((i) => i.config.name);
    expect(names).toContain("idx_row_changes_row");
    expect(names).toContain("idx_row_changes_batch");
  });
});
