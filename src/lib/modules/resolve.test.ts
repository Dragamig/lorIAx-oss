import { describe, it, expect } from "vitest";
import { resolveModuleState, isEntitled } from "./resolve";
import type { ModuleManifest, EnablementContext } from "./types";

const base: ModuleManifest = {
  id: "meeting-rooms",
  name: "Salles de réunion",
  description: "",
  dependencies: [],
  entitlement: "core",
  defaultEnabled: false,
  category: "communication",
  icon: "door-open",
  manageRole: "super_admin",
  nav: [],
};

function ctx(partial: Partial<EnablementContext> = {}): EnablementContext {
  return {
    compiled: new Set(["meeting-rooms"]),
    entitledModuleIds: new Set(),
    toggles: {},
    ...partial,
  };
}

describe("isEntitled", () => {
  it("core est toujours autorisé", () => {
    expect(isEntitled(base, new Set())).toBe(true);
  });
  it("licensed requiert l'id du module dans l'ensemble autorisé", () => {
    const m = { ...base, entitlement: "licensed" as const };
    expect(isEntitled(m, new Set())).toBe(false);
    expect(isEntitled(m, new Set(["meeting-rooms"]))).toBe(true);
  });
});

describe("resolveModuleState", () => {
  it("non compilé -> unavailable", () => {
    const s = resolveModuleState(base, ctx({ compiled: new Set() }), [base]);
    expect(s.status).toBe("unavailable");
  });
  it("compilé core mais toggle off (défaut) -> disabled", () => {
    const s = resolveModuleState(base, ctx(), [base]);
    expect(s.status).toBe("disabled");
  });
  it("compilé core toggle on -> active", () => {
    const s = resolveModuleState(
      base,
      ctx({ toggles: { "meeting-rooms": true } }),
      [base]
    );
    expect(s.status).toBe("active");
  });
  it("licensed non autorisé -> locked", () => {
    const m = { ...base, entitlement: "licensed" as const, defaultEnabled: true };
    const s = resolveModuleState(
      m,
      ctx({ toggles: { "meeting-rooms": true } }),
      [m]
    );
    expect(s.status).toBe("locked");
  });
  it("licensed autorisé + toggle on -> active", () => {
    const m = { ...base, entitlement: "licensed" as const };
    const s = resolveModuleState(
      m,
      ctx({
        entitledModuleIds: new Set(["meeting-rooms"]),
        toggles: { "meeting-rooms": true },
      }),
      [m]
    );
    expect(s.status).toBe("active");
  });
  it("toggle stocké prime sur defaultEnabled", () => {
    const m = { ...base, defaultEnabled: true };
    const s = resolveModuleState(
      m,
      ctx({ toggles: { "meeting-rooms": false } }),
      [m]
    );
    expect(s.status).toBe("disabled");
  });
  it("dépendance inactive -> blocked-deps", () => {
    const dep: ModuleManifest = { ...base, id: "meeting-rooms", defaultEnabled: false };
    const main: ModuleManifest = {
      ...base,
      id: "studiovideo",
      entitlement: "core",
      defaultEnabled: true,
      dependencies: ["meeting-rooms"],
    };
    const context = ctx({
      compiled: new Set(["meeting-rooms", "studiovideo"]),
      toggles: { studiovideo: true },
    });
    const s = resolveModuleState(main, context, [dep, main]);
    expect(s.status).toBe("blocked-deps");
    expect(s.missingDeps).toEqual(["meeting-rooms"]);
  });
});
