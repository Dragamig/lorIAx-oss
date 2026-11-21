import { getHooks } from "./hooks";
import { getModuleManifests, getModuleManifest } from "./registry";
import { getModuleToggles } from "./toggle";
import { resolveModuleState } from "./resolve";
import type { EnablementContext, ModuleId, ModuleState } from "./types";

/**
 * Contexte d'autorisation des modules (droits fournis par le hook `entitlements`).
 *
 * @param orgId organisation dont le plan doit borner les modules autorisés.
 *   `null`/`undefined` = aucun scope organisation : seule la licence d'instance
 *   décide (mono-tenant self-hosted, administration d'instance).
 */
async function getEnablementContext(
  orgId?: string | null
): Promise<EnablementContext> {
  const manifests = getModuleManifests();
  // `null` = tout module compilé est autorisé (hook neutre, sans module commercial).
  const hookIds = await getHooks().entitlements.getEntitledModuleIds(orgId);
  const entitledModuleIds = hookIds ?? new Set<string>(manifests.map((m) => m.id));
  // "compilé" = présent dans l'image. Piloté par registry.generated.ts (allowlist)
  // via getModuleManifests() : un module exclu au build n'apparaît pas ici (SP2).
  const compiled = new Set<ModuleId>(manifests.map((m) => m.id));
  const toggles = await getModuleToggles(manifests);
  return { compiled, entitledModuleIds, toggles };
}

/**
 * État résolu de tous les modules (pour l'UI super_admin).
 *
 * @param orgId borne facultative : plan effectif de l'organisation ciblée.
 */
export async function getModulesState(
  orgId?: string | null
): Promise<ModuleState[]> {
  const manifests = getModuleManifests();
  const ctx = await getEnablementContext(orgId);
  return manifests.map((m) => resolveModuleState(m, ctx, manifests));
}

/**
 * Vrai ssi le module est ACTIF (compilé ∧ autorisé ∧ activé ∧ deps actives).
 *
 * @param orgId borne facultative : plan effectif de l'organisation ciblée.
 */
export async function isModuleActive(
  id: ModuleId,
  orgId?: string | null
): Promise<boolean> {
  const manifest = getModuleManifest(id);
  if (!manifest) return false;
  const manifests = getModuleManifests();
  const ctx = await getEnablementContext(orgId);
  return resolveModuleState(manifest, ctx, manifests).status === "active";
}
