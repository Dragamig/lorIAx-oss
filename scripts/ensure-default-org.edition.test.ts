/**
 * Organisation par defaut selon l'edition : creee seulement sans le module commercial
 * (en commercial, register-org / provision-org creent les organisations).
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ModuleId } from "../src/lib/modules/types";
import { ensureDefaultOrganizationForEdition } from "./ensure-default-org";

function fakePool() {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT")) return { rows: [] };
    return { rows: [{ id: "org-1" }] };
  });
  return { pool: { query } as unknown as Pool, query };
}

describe("ensureDefaultOrganizationForEdition", () => {
  it("edition oss (module commercial absent) : cree l'organisation par defaut", async () => {
    const { pool, query } = fakePool();
    const ids: ModuleId[] = ["ai", "crm"];
    const res = await ensureDefaultOrganizationForEdition(pool, ids);
    expect(res).toEqual({ id: "org-1", created: true });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO organizations"))).toBe(true);
  });

  it("edition commerciale : n'ouvre aucune requete et ne cree rien", async () => {
    const { pool, query } = fakePool();
    const ids: ModuleId[] = ["ai", "crm", "commercial"];
    const res = await ensureDefaultOrganizationForEdition(pool, ids);
    expect(res).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
