import { describe, it, expect } from "vitest";
import { parseToggleValue, resolveToggleKey, TOGGLE_PREFIX } from "./toggle";
import type { ModuleManifest } from "./types";

const m: ModuleManifest = {
  id: "studiovideo",
  name: "",
  description: "",
  dependencies: [],
  entitlement: "core",
  defaultEnabled: false,
  category: "contenu",
  icon: "clapperboard",
  manageRole: "admin",
  nav: [],
};

describe("parseToggleValue", () => {
  it("accepte un booléen direct", () => {
    expect(parseToggleValue(true)).toBe(true);
    expect(parseToggleValue(false)).toBe(false);
  });
  it("accepte { enabled: bool }", () => {
    expect(parseToggleValue({ enabled: true })).toBe(true);
    expect(parseToggleValue({ enabled: 0 })).toBe(false);
  });
  it("renvoie null pour une valeur inconnue", () => {
    expect(parseToggleValue("oui")).toBeNull();
    expect(parseToggleValue(null)).toBeNull();
  });
});

describe("parseToggleValue avec sous-champ", () => {
  it("lit le sous-champ booléen sans toucher au reste de la config", () => {
    expect(parseToggleValue({ livekitEnabled: true, url: "x" }, "livekitEnabled")).toBe(true);
    expect(parseToggleValue({ livekitEnabled: false }, "livekitEnabled")).toBe(false);
  });
  it("renvoie null si le sous-champ est absent", () => {
    expect(parseToggleValue({ url: "x" }, "livekitEnabled")).toBeNull();
    expect(parseToggleValue(null, "livekitEnabled")).toBeNull();
  });
  // Régression : la clé meeting_rooms_enabled a longtemps été écrite en booléen
  // nu par l'ancienne page Services. Le manifeste déclare maintenant le
  // sous-champ « enabled » et une migration normalise la base, mais les
  // migrations de données ne sont pas jouées automatiquement au déploiement.
  // Sans cette tolérance, une instance non migrée éteint le module en silence.
  it("tolère la forme héritée en booléen nu malgré un sous-champ déclaré", () => {
    expect(parseToggleValue(true, "enabled")).toBe(true);
    expect(parseToggleValue(false, "enabled")).toBe(false);
  });
});

describe("resolveToggleKey", () => {
  it("clé par défaut préfixée", () => {
    expect(resolveToggleKey(m)).toBe(`${TOGGLE_PREFIX}studiovideo`);
  });
  it("respecte une clé legacy", () => {
    expect(resolveToggleKey({ ...m, toggleKey: "meeting_rooms_enabled" })).toBe(
      "meeting_rooms_enabled"
    );
  });
});

describe("buildModuleToggleQuery", () => {
  it("génère un upsert atomique paramétré", async () => {
    const { buildModuleToggleQuery } = await import("./toggle");
    const { getModuleManifests } = await import("./registry");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const manifest = getModuleManifests()[0];
    const q = new PgDialect().sqlToQuery(buildModuleToggleQuery(manifest, true));
    expect(q.sql).toContain("ON CONFLICT (key) DO UPDATE");
    expect(q.sql).toContain("|| EXCLUDED.value");
    expect(q.sql).not.toContain(manifest.id);
    expect(q.params).toContain(resolveToggleKey(manifest));
    expect(q.params).toContain(true);
  });
  it("refuse un module absent du registre", async () => {
    const { buildModuleToggleQuery } = await import("./toggle");
    expect(() => buildModuleToggleQuery({ ...m, id: "x'; DROP TABLE y;--" as never }, true)).toThrow(/inconnu/);
  });
});
