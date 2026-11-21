import { INCLUDED_MODULE_IDS } from "@/lib/modules/registry.generated";
import type { ModuleId } from "@/lib/modules/types";

/**
 * Valeur effective de `system_settings.auth.allowRegistration`, selon l'edition.
 * Source unique partagee par la politique serveur (`registration-policy.ts`) et
 * par la lecture des reglages de l'ecran d'administration.
 *
 * - commerciale (module `commercial` present) : ouverte sauf `false` explicite ;
 * - oss : fermee sauf `true` explicite.
 */
export function resolveAllowRegistration(
  stored: unknown,
  includedModuleIds: readonly ModuleId[] = INCLUDED_MODULE_IDS,
): boolean {
  const commercial = includedModuleIds.includes("commercial");
  return commercial ? stored !== false : stored === true;
}
