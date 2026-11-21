import { describe, expect, it } from "vitest";
import fr from "../../../../messages/fr.json";
import { CRM_ACTIONS, getCrmAction } from "../actions";

function resolve(key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], (fr as { crm: unknown }).crm);
}

describe("registre d'actions CRM", () => {
  it("chaque action a un libellé présent dans messages/fr.json (crm.*), une icône et un id unique", () => {
    const ids = CRM_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "chooseBase", "showFields", "openInBases", "dissociateRole", "deactivate",
      "retry", "goToRaccordement", "activate", "cancelActivation",
      "activation.setMode", "activation.pickBase", "activation.adopt", "activation.switchOrg",
      "activation.confirm", "activation.undo", "activation.toggleRecap",
    ]);
    for (const a of CRM_ACTIONS) {
      expect(typeof resolve(a.labelKey), a.id).toBe("string");
      expect(a.icon, a.id).toBeTruthy();
    }
  });

  it("aucun libellé d'action ne contient de tiret cadratin", () => {
    for (const a of CRM_ACTIONS) {
      expect(resolve(a.labelKey) as string).not.toMatch(/[—–]/);
    }
  });

  it("getCrmAction lève sur un id inconnu", () => {
    expect(getCrmAction("retry").id).toBe("retry");
    expect(() => getCrmAction("nope")).toThrow();
  });
});
