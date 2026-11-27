import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CRM_ACTIONS } from "@/lib/crm/actions";
import fr from "../../../messages/fr.json";

function resolve(key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], (fr as { crm: unknown }).crm);
}

const dir = join(process.cwd(), "src/components/crm");
function collect(d: string): string[] {
  return readdirSync(d).flatMap((f) => {
    const full = join(d, f);
    if (statSync(full).isDirectory()) return collect(full);
    return /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [full] : [];
  });
}
const sources = collect(dir)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("couverture du registre d'actions CRM", () => {
  const surfaces = ["raccordement", "tally", "disabled", "activation", "modal", "pipeline", "relances", "dossiers", "contacts", "fiche"];
  for (const action of CRM_ACTIONS.filter((a) => surfaces.includes(a.surface))) {
    it(`l'action ${action.id} est utilisée par un composant`, () => {
      expect(sources).toMatch(new RegExp(`["'\`]${action.id.replace(/\./g, "\\.")}["'\`]`));
    });
  }

  it("chaque getCrmAction(...) et actionId désigne un id existant", () => {
    const ids = new Set(CRM_ACTIONS.map((a) => a.id));
    const used = [...sources.matchAll(/(?:getCrmAction\(|actionId=)\s*\{?["`']([A-Za-z.]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(ids.has(id)).toBe(true);
  });

  it("chaque data-action rendu par un composant existe dans le registre", () => {
    const ids = new Set(CRM_ACTIONS.map((a) => a.id));
    const used = [...sources.matchAll(/data-action=(?:"|'|\{"|\{')([A-Za-z.]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(ids.has(id), id).toBe(true);
  });

  it("actions-coverage : chaque action d'activation a icône, libellé et tip", () => {
    const modal = CRM_ACTIONS.filter((a) => a.id.startsWith("activation."));
    expect(modal.length).toBe(8);
    for (const a of modal) {
      expect(a.icon, a.id).toBeTruthy();
      expect(typeof resolve(a.labelKey), `${a.id} libellé`).toBe("string");
      expect(a.tipKey, `${a.id} tip`).toBeTruthy();
      expect(typeof resolve(a.tipKey as string), `${a.id} tip`).toBe("string");
    }
  });
});
