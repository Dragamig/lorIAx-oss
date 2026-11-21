import { z } from "zod";
import type { ModuleId } from "./types";
import { getAllModuleManifests } from "./registry";
import { MODULES_BY_PLAN } from "./catalog";

const profileSchema = z.object({
  client: z.string().min(1),
  plan: z.enum(["free", "growth", "enterprise"]),
  modules: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type ClientProfile = {
  client: string;
  plan: "free" | "growth" | "enterprise";
  modules: ModuleId[];
  exclude: ModuleId[];
  meta?: Record<string, unknown>;
};

/** Valide et normalise un objet de profil (issu d'un JSON). Lève si invalide. */
export function parseClientProfile(input: unknown): ClientProfile {
  const parsed = profileSchema.parse(input);
  return parsed as ClientProfile;
}

/**
 * Ensemble final des modules présents dans l'image :
 * core ∪ socle(plan) ∪ add-ons, fermé transitivement sur les dépendances.
 * puis retrait des modules `exclude` (après la fermeture).
 * Lève si un add-on ou un exclude référence un id inconnu, si un id est à la fois
 * dans modules et exclude, ou si un module inclus dépend d'un module exclu.
 */
export function resolveIncludedModules(profile: ClientProfile): Set<ModuleId> {
  // Registre complet : outil de build, ne doit pas dépendre de registry.generated.
  const all = getAllModuleManifests();
  const byId = new Map(all.map((m) => [m.id, m] as const));
  const included = new Set<ModuleId>();

  for (const m of all) if (m.entitlement === "core") included.add(m.id);
  for (const id of MODULES_BY_PLAN[profile.plan]) included.add(id);
  for (const id of profile.modules) {
    if (!byId.has(id as ModuleId)) throw new Error(`Module inconnu dans le profil: ${id}`);
    included.add(id as ModuleId);
  }

  const exclude = profile.exclude ?? [];
  for (const id of exclude) {
    if (!byId.has(id)) throw new Error(`Module inconnu dans exclude: ${id}`);
    if (profile.modules.includes(id)) {
      throw new Error(`Module ${id} présent à la fois dans modules et dans exclude`);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...included]) {
      for (const dep of byId.get(id)!.dependencies) {
        if (!included.has(dep)) {
          included.add(dep);
          changed = true;
        }
      }
    }
  }

  for (const id of exclude) included.delete(id);
  for (const id of included) {
    for (const dep of byId.get(id)!.dependencies) {
      if (exclude.includes(dep)) throw new Error(`Module ${id} dépend du module exclu ${dep}`);
    }
  }
  return included;
}
