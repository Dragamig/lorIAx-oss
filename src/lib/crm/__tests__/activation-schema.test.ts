import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { activateBodySchema, activateBodyV2Schema } from "../fields";
import { crmConnections } from "@/lib/db/schema-crm";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("schéma strict de POST activate (v2)", () => {
  it("accepte les trois modes de rôle et les deux modes d'espace", () => {
    const ok = activateBodyV2Schema.safeParse({
      space: { mode: "existing", spaceId: UUID },
      roles: {
        contacts: { mode: "connect", databaseId: UUID, fieldMap: { nom: UUID } },
        dossiers: { mode: "complete", databaseId: UUID },
        interactions: { mode: "create" },
      },
    });
    expect(ok.success).toBe(true);
    expect(activateBodyV2Schema.safeParse({ space: { mode: "create" }, roles: {} }).success).toBe(true);
  });

  it("orgId injecté : rejeté", () => {
    expect(activateBodyV2Schema.safeParse({ orgId: UUID, space: { mode: "create" }, roles: {} }).success).toBe(false);
    expect(
      activateBodyV2Schema.safeParse({ space: { mode: "create", orgId: UUID }, roles: {} }).success,
    ).toBe(false);
    expect(
      activateBodyV2Schema.safeParse({ space: { mode: "create" }, roles: { contacts: { mode: "create", orgId: UUID } } }).success,
    ).toBe(false);
  });

  it("liste de colonnes à ajouter fournie par le client : rejetée", () => {
    for (const role of [
      { mode: "complete", databaseId: UUID, columns: [{ name: "X", type: "text" }] },
      { mode: "complete", databaseId: UUID, missing: [] },
      { mode: "create", columns: [] },
      { mode: "connect", databaseId: UUID, missing: [] },
    ]) {
      expect(activateBodyV2Schema.safeParse({ space: { mode: "create" }, roles: { contacts: role } }).success).toBe(false);
    }
  });

  it("fieldMap en mode complete ou create : rejeté", () => {
    for (const role of [
      { mode: "complete", databaseId: UUID, fieldMap: { nom: UUID } },
      { mode: "create", fieldMap: { nom: UUID } },
    ]) {
      expect(activateBodyV2Schema.safeParse({ space: { mode: "create" }, roles: { contacts: role } }).success).toBe(false);
    }
  });

  it("rôle, mode ou identifiants invalides : rejetés", () => {
    const cases = [
      { space: { mode: "existing", spaceId: "x" }, roles: {} },
      { space: { mode: "autre" }, roles: {} },
      { roles: {} },
      { space: { mode: "create" }, roles: { autre: { mode: "create" } } },
      { space: { mode: "create" }, roles: { contacts: { mode: "connect", databaseId: "x" } } },
      { space: { mode: "create" }, roles: { contacts: { mode: "connect" } } },
    ];
    for (const c of cases) expect(activateBodyV2Schema.safeParse(c).success).toBe(false);
  });

  it("bindings historiques toujours acceptés", () => {
    expect(activateBodySchema.safeParse({ bindings: { contacts: { databaseId: UUID } } }).success).toBe(true);
    expect(activateBodySchema.safeParse({}).success).toBe(true);
  });
});

describe("colonne created_automation_keys de crm_connections", () => {
  it("existe, jsonb non nulle, défaut tableau vide", () => {
    const col = getTableColumns(crmConnections).createdAutomationKeys;
    expect(col).toBeDefined();
    expect(col.name).toBe("created_automation_keys");
    expect(col.notNull).toBe(true);
    expect(col.default).toEqual([]);
  });
});
