import { getModuleManifests } from "./registry";
import { getModulesState } from "./enablement";
import type { ModuleManifest } from "./types";

/** Capacités exposées au client : modules actifs + extensions/commandes qu'ils fournissent. */
export interface ActiveCapabilities {
  /** Ids des modules ACTIFS. */
  modules: string[];
  /** Clés d'extensions TipTap à charger. */
  editorExtensions: string[];
  /** Titres des /commandes à exposer dans le menu slash. */
  slashCommands: string[];
}

/**
 * Agrège (pur) les capacités des modules actifs.
 * Les ids sans manifeste correspondant sont ignorés ; extensions et commandes
 * sont dédupliquées.
 */
export function collectCapabilities(
  activeIds: string[],
  manifests: ModuleManifest[]
): ActiveCapabilities {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const modules: string[] = [];
  const editorExtensions = new Set<string>();
  const slashCommands = new Set<string>();

  for (const id of activeIds) {
    const m = byId.get(id as ModuleManifest["id"]);
    if (!m) continue;
    modules.push(m.id);
    for (const ext of m.editorExtensions ?? []) editorExtensions.add(ext);
    for (const cmd of m.slashCommands ?? []) slashCommands.add(cmd);
  }

  return {
    modules,
    editorExtensions: [...editorExtensions],
    slashCommands: [...slashCommands],
  };
}

/**
 * Capacités actives résolues depuis la BDD (licence + plan d'organisation +
 * toggles + dépendances).
 *
 * @param orgId borne facultative : plan effectif de l'organisation ciblée.
 *   Absent = seule la licence d'instance décide (mono-tenant self-hosted).
 */
export async function getActiveCapabilities(
  orgId?: string | null
): Promise<ActiveCapabilities> {
  const states = await getModulesState(orgId);
  const activeIds = states.filter((s) => s.status === "active").map((s) => s.id);
  return collectCapabilities(activeIds, getModuleManifests());
}
