import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseClientProfile, resolveIncludedModules } from "../src/lib/modules/composition";
import { getAllModuleManifests } from "../src/lib/modules/registry";
import { computePrunable } from "./prune-modules";

const ROOT = resolve(__dirname, "..");
const load = (f: string) => parseClientProfile(JSON.parse(readFileSync(resolve(ROOT, f), "utf8")));

/** Cas de resolution d'un profil depuis un etat genere reduit (registre complet attendu). */
export function registerProfileResolutionCases(files: string[]): void {
  for (const f of files) {
    it(`profile_${f}_resolves_from_full_registry`, () => {
      const profile = load(f);
      const set = resolveIncludedModules(profile);
      const all = getAllModuleManifests();
      const expected = new Set(all.filter((m) => m.entitlement === "core").map((m) => m.id));
      expect(set.size).toBeGreaterThan(expected.size - 1);
      for (const id of expected) if (!profile.exclude.includes(id)) expect(set.has(id)).toBe(true);
      for (const id of profile.modules) expect(set.has(id)).toBe(true);
      for (const id of profile.exclude) expect(set.has(id)).toBe(false);
    });

    it(`prune_${f}_uses_full_registry`, () => {
      const profile = load(f);
      const tracked = getAllModuleManifests().flatMap((m) => m.ownedPaths ?? []).filter((p) => !p.includes("*"));
      const pruned = computePrunable(profile, tracked);
      const set = resolveIncludedModules(profile);
      expect(set.has("commercial")).toBe(!profile.exclude.includes("commercial"));
      expect(Array.isArray(pruned)).toBe(true);
    });
  }
}
