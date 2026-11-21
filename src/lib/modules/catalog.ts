import type { Plan } from "@/lib/license/types";
import type { ModuleId } from "./types";
import { getModuleManifests } from "./registry";

/**
 * Modules de socle par plan. Cumulatif : enterprise ⊃ growth ⊃ free.
 * Les modules "core" (toujours autorisés) ne figurent PAS ici — ils sont
 * autorisés via leur entitlement, pas via le plan.
 */
const GROWTH_MODULES: ModuleId[] = [
  "ai",
  "automations",
  "backup",
  "livekit",
  "whisper",
  "voice-notes",
];
const ENTERPRISE_MODULES: ModuleId[] = [
  ...GROWTH_MODULES,
  "ldap",
  "meeting-rooms",
];

export const MODULES_BY_PLAN: Record<Plan, ModuleId[]> = {
  free: [],
  growth: GROWTH_MODULES,
  enterprise: ENTERPRISE_MODULES,
};

/** Ids des modules autorisés = socle du plan ∪ add-ons accordés à la carte. */
export function getEntitledModuleIds(
  plan: Plan,
  addonModules: string[] = []
): Set<string> {
  return new Set<string>([...MODULES_BY_PLAN[plan], ...addonModules]);
}

export interface SellableModule {
  id: ModuleId;
  label: string;
  /** "core" = inclus partout ; "licensed" = nécessite une licence. */
  class: "core" | "licensed";
  /** Plan minimal dont le socle inclut ce module ; null si add-on pur ou core. */
  planFloor: Plan | null;
  dependencies: ModuleId[];
}

/** Catalogue dérivé des manifestes — source de vérité pour l'UI license-manager. */
export function getSellableCatalog(): SellableModule[] {
  const floorOf = (id: ModuleId): Plan | null => {
    if (MODULES_BY_PLAN.growth.includes(id)) return "growth";
    if (MODULES_BY_PLAN.enterprise.includes(id)) return "enterprise";
    return null;
  };
  // Les modules internes (édition commerciale) ne se vendent pas : hors catalogue.
  return getModuleManifests()
    .filter((m) => !m.internal)
    .map((m) => ({
      id: m.id,
      label: m.name,
      class: m.entitlement === "core" ? "core" : "licensed",
      planFloor: m.entitlement === "core" ? null : floorOf(m.id),
      dependencies: m.dependencies,
    }));
}
