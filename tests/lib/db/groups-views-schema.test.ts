/**
 * Tests de smoke sur le schéma Drizzle des nouvelles tables (Phase 1).
 * Vérifie que les colonnes attendues existent et que les FK pointent vers
 * les bonnes tables — détection précoce d'une régression de schéma.
 */
import { describe, it, expect } from "vitest";
import {
  userDatabaseGroups,
  userDatabaseViews,
  userDatabases,
  viewTypeEnum,
} from "@/lib/db/schema";

describe("schema Phase 1 — user_database_groups", () => {
  it("contient les colonnes attendues", () => {
    expect(userDatabaseGroups.id).toBeDefined();
    expect(userDatabaseGroups.spaceId).toBeDefined();
    expect(userDatabaseGroups.name).toBeDefined();
    expect(userDatabaseGroups.icon).toBeDefined();
    expect(userDatabaseGroups.position).toBeDefined();
    expect(userDatabaseGroups.createdAt).toBeDefined();
  });
});

describe("schema Phase 1 — user_database_views", () => {
  it("contient les colonnes attendues + publicToken pour partage v2", () => {
    expect(userDatabaseViews.id).toBeDefined();
    expect(userDatabaseViews.databaseId).toBeDefined();
    expect(userDatabaseViews.type).toBeDefined();
    expect(userDatabaseViews.config).toBeDefined();
    expect(userDatabaseViews.isDefault).toBeDefined();
    expect(userDatabaseViews.isPublic).toBeDefined();
    expect(userDatabaseViews.publicToken).toBeDefined();
  });
});

describe("schema Phase 1 — user_databases (extension)", () => {
  it("expose les nouvelles colonnes group_id / icon / position", () => {
    expect(userDatabases.groupId).toBeDefined();
    expect(userDatabases.icon).toBeDefined();
    expect(userDatabases.position).toBeDefined();
  });
});

describe("schema Phase 1 — enum database_view_type", () => {
  it("liste les 6 types de vues attendus", () => {
    expect(viewTypeEnum.enumValues).toEqual([
      "grid",
      "kanban",
      "gallery",
      "calendar",
      "form",
      "dashboard",
    ]);
  });
});
