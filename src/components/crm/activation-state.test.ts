import { describe, expect, it } from "vitest";
import type { ActivationPreview } from "@/lib/crm/preview";
import {
  availableModes,
  collisionOf,
  defaultMode,
  initialState,
  invalidRoles,
  isSpaceSelectorDisabled,
  missingBases,
  toRequestBody,
  type ActivationState,
} from "./activation-state";

const SP = "11111111-1111-4111-8111-111111111111";
const DB1 = "22222222-2222-4222-8222-222222222222";
const DB2 = "33333333-3333-4333-8333-333333333333";

function cand(databaseId: string, status: "compatible" | "almost" | "none") {
  return {
    databaseId, name: `Base ${databaseId.slice(0, 2)}`, spaceId: SP, spaceName: "CRM", columns: [],
    proposal: {}, score: 90, compatible: status === "compatible", status, missing: [],
  };
}

function preview(over: Partial<ActivationPreview> = {}): ActivationPreview {
  return {
    roles: {
      contacts: { candidates: [cand(DB1, "compatible")], preselected: DB1 },
      dossiers: { candidates: [cand(DB2, "almost")], preselected: null },
      interactions: { candidates: [], preselected: null },
    },
    existing: false,
    spaces: [{ id: SP, name: "CRM" }],
    suggestedSpaceId: SP,
    collisions: { contacts: [], dossiers: [], interactions: [] },
    orgs: [],
    ...over,
  };
}

function state(over: Partial<ActivationState> = {}): ActivationState {
  return {
    orgSlug: "acme",
    spaceId: SP,
    roles: {
      contacts: { mode: "connect", databaseId: DB1 },
      dossiers: { mode: "complete", databaseId: DB2 },
      interactions: { mode: "create", databaseId: null },
    },
    ...over,
  };
}

describe("état de la modale d'activation", () => {
  it("modes par défaut selon le statut", () => {
    expect(defaultMode("contacts", [cand(DB1, "almost"), cand(DB2, "compatible")])).toBe("connect");
    expect(defaultMode("contacts", [cand(DB1, "almost")])).toBe("complete");
    expect(defaultMode("contacts", [cand(DB1, "none")])).toBe("create");
    expect(defaultMode("contacts", [])).toBe("create");
  });

  it("sélecteur d'espace désactivé sans rôle en create", () => {
    expect(isSpaceSelectorDisabled(state())).toBe(false);
    const s = state();
    s.roles.interactions = { mode: "connect", databaseId: null };
    expect(isSpaceSelectorDisabled(s)).toBe(true);
  });

  it("base prise par un autre rôle : indisponible avec raison", () => {
    const p = preview();
    const s = state();
    s.roles.dossiers = { mode: "connect", databaseId: DB1 };
    const modes = availableModes("dossiers", s, p);
    expect(modes.connect).toEqual({ ok: false, reason: "activation.mode.connectUnavailable" });
    const contacts = availableModes("contacts", s, p);
    expect(contacts.connect).toEqual({ ok: false, reason: "activation.mode.allTaken" });
    expect(availableModes("contacts", state(), p).connect.ok).toBe(true);
  });

  it("collision : create indisponible, connect proposé sur la base existante", () => {
    const p = preview({
      roles: {
        contacts: { candidates: [], preselected: null },
        dossiers: { candidates: [cand(DB2, "compatible")], preselected: DB2 },
        interactions: { candidates: [], preselected: null },
      },
      collisions: { contacts: [], dossiers: [{ databaseId: DB2, name: "Dossiers" }], interactions: [] },
    });
    expect(collisionOf("dossiers", p)).toEqual({ databaseId: DB2, name: "Dossiers" });
    const s = state();
    s.roles.dossiers = { mode: "create", databaseId: null };
    const modes = availableModes("dossiers", s, p);
    expect(modes.create).toEqual({ ok: false, reason: "activation.mode.createUnavailable", reasonValues: { name: "Dossiers" } });
    expect(modes.connect.ok).toBe(true);
    // espace à créer ou autre espace : pas de collision
    expect(availableModes("dossiers", state({ spaceId: "create" }), p).create.ok).toBe(true);
    expect(collisionOf("dossiers", p, "autre")).toBeNull();
  });

  it("toRequestBody ne contient aucune clé orgId ni liste de colonnes", () => {
    const body = toRequestBody(state());
    expect(body).toEqual({
      space: { mode: "existing", spaceId: SP },
      roles: {
        contacts: { mode: "connect", databaseId: DB1 },
        dossiers: { mode: "complete", databaseId: DB2 },
        interactions: { mode: "create" },
      },
    });
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/orgId|organi|columns|fieldMap/);
    expect(toRequestBody(state({ spaceId: "create" })).space).toEqual({ mode: "create" });
  });

  it("rôle connect sans base : listé et toRequestBody lève", () => {
    const s = state();
    s.roles.contacts = { mode: "connect", databaseId: null };
    expect(missingBases(s)).toEqual(["contacts"]);
    expect(() => toRequestBody(s)).toThrow(/contacts/);
    expect(missingBases(state())).toEqual([]);
  });

  it("collision sur une base presque compatible : complete sur cette base", () => {
    const p = preview({
      roles: {
        contacts: { candidates: [], preselected: null },
        dossiers: { candidates: [cand(DB1, "compatible"), cand(DB2, "almost")], preselected: DB1 },
        interactions: { candidates: [], preselected: null },
      },
      collisions: { contacts: [], dossiers: [{ databaseId: DB2, name: "Dossiers" }], interactions: [] },
    });
    const s = initialState(p, "acme");
    expect(s.roles.dossiers).toEqual({ mode: "connect", databaseId: DB1 });
    const only = preview({
      roles: {
        contacts: { candidates: [], preselected: null },
        dossiers: { candidates: [cand(DB2, "almost")], preselected: null },
        interactions: { candidates: [], preselected: null },
      },
      collisions: { contacts: [], dossiers: [{ databaseId: DB2, name: "Dossiers" }], interactions: [] },
    });
    const s2 = initialState(only, "acme");
    expect(s2.roles.dossiers).toEqual({ mode: "complete", databaseId: DB2 });
    expect(invalidRoles(s2, only)).toEqual([]);
  });

  it("deux rôles qui visent la même base compatible : le second ne la prend pas", () => {
    const p = preview({
      roles: {
        contacts: { candidates: [cand(DB1, "compatible")], preselected: DB1 },
        dossiers: { candidates: [cand(DB1, "compatible")], preselected: DB1 },
        interactions: { candidates: [], preselected: null },
      },
    });
    const s = initialState(p, "acme");
    expect(s.roles.contacts).toEqual({ mode: "connect", databaseId: DB1 });
    expect(s.roles.dossiers).toEqual({ mode: "create", databaseId: null });
    expect(invalidRoles(s, p)).toEqual([]);
    expect(s.orgSlug).toBe("acme");
  });
});
