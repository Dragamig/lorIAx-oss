import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseClientProfile, resolveIncludedModules } from "./composition";
import { getAllModuleManifests } from "./registry";

// L'export de l'édition publique retire du registre les modules exclus : leurs gardes sont sans objet.
const hasStudiovideo = getAllModuleManifests().some((m) => m.id === "studiovideo");

describe("parseClientProfile", () => {
  it("accepte un profil valide", () => {
    const p = parseClientProfile({ client: "exemple", plan: "growth", modules: ["studio"] });
    expect(p.client).toBe("exemple");
    expect(p.plan).toBe("growth");
    expect(p.modules).toEqual(["studio"]);
  });
  it("rejette un plan inconnu", () => {
    expect(() => parseClientProfile({ client: "x", plan: "ultra", modules: [] })).toThrow();
  });
  it("rejette un client manquant", () => {
    expect(() => parseClientProfile({ plan: "free", modules: [] })).toThrow();
  });
});

describe("resolveIncludedModules", () => {
  it("inclut toujours les modules core", () => {
    const set = resolveIncludedModules(parseClientProfile({ client: "x", plan: "free", modules: [] }));
    expect(set.has("collab")).toBe(true);
    expect(set.has("email")).toBe(true);
    expect(set.has("images")).toBe(true);
  });
  it("inclut le socle du plan", () => {
    const set = resolveIncludedModules(parseClientProfile({ client: "x", plan: "growth", modules: [] }));
    expect(set.has("ai")).toBe(true);
    expect(set.has("livekit")).toBe(true);
  });
  it("étend les dépendances (whisper → livekit)", () => {
    const set = resolveIncludedModules(parseClientProfile({ client: "x", plan: "free", modules: ["whisper"] }));
    expect(set.has("whisper")).toBe(true);
    expect(set.has("livekit")).toBe(true);
  });
  it("exclut les add-ons non demandés hors socle", () => {
    const set = resolveIncludedModules(parseClientProfile({ client: "x", plan: "free", modules: ["studio"] }));
    expect(set.has("studio")).toBe(true);
    expect(set.has("ldap")).toBe(false);
    expect(set.has("meeting-rooms")).toBe(false);
  });
  it("rejette un id de module inconnu", () => {
    expect(() =>
      resolveIncludedModules({ client: "x", plan: "free", modules: ["inexistant"] as never, exclude: [] })
    ).toThrow(/inconnu/i);
  });
});

describe("exclude", () => {
  const base = { client: "x", plan: "enterprise" as const };
  it.skipIf(!hasStudiovideo)("exclude_removes_core_module_after_closure", () => {
    const set = resolveIncludedModules(parseClientProfile({ ...base, modules: [], exclude: ["studiovideo"] }));
    expect(set.has("studiovideo")).toBe(false);
    for (const id of ["studio", "crm", "ai", "meeting-rooms"]) expect(set.has(id as never)).toBe(true);
  });
  it("exclude_throws_on_unknown_id", () => {
    expect(() =>
      resolveIncludedModules(parseClientProfile({ ...base, modules: [], exclude: ["inexistant"] }))
    ).toThrow("Module inconnu dans exclude: inexistant");
  });
  it("exclude_throws_when_included_module_depends_on_excluded", () => {
    expect(() =>
      resolveIncludedModules(parseClientProfile({ ...base, modules: ["whisper"], exclude: ["livekit"] }))
    ).toThrow("Module whisper dépend du module exclu livekit");
  });
  it("exclude_throws_when_also_in_modules", () => {
    expect(() =>
      resolveIncludedModules(parseClientProfile({ ...base, modules: ["studio"], exclude: ["studio"] }))
    ).toThrow(/studio/);
  });
  it.skipIf(!hasStudiovideo)("exclude_removes_core_entitlement_module", () => {
    const set = resolveIncludedModules(parseClientProfile({ client: "x", plan: "free", modules: [], exclude: ["studiovideo"] }));
    expect(set.has("studiovideo")).toBe(false);
    expect(set.has("collab")).toBe(true);
  });
});
