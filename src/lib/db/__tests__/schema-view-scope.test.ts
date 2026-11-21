import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { userDatabaseViews, VIEW_SCOPES } from "../schema";

describe("schema portée des vues", () => {
  it("userDatabaseViews expose scope", () => {
    const col = getTableColumns(userDatabaseViews).scope;
    expect(col).toBeDefined();
    expect(col.notNull).toBe(true);
    expect(col.default).toBe("shared");
    expect(VIEW_SCOPES).toEqual(["shared", "personal"]);
  });

  it("les deux index uniques partiels existent et l'ancien a disparu", () => {
    const idx = getTableConfig(userDatabaseViews).indexes.map((i) => i.config.name);
    expect(idx).toEqual(
      expect.arrayContaining(["idx_user_database_views_name_shared", "idx_user_database_views_name_personal"]),
    );
    expect(idx).not.toContain("idx_user_database_views_unique_name");
  });
});
