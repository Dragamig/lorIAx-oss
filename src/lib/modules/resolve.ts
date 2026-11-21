import type {
  EnablementContext,
  ModuleManifest,
  ModuleState,
} from "./types";

export function isEntitled(
  manifest: ModuleManifest,
  entitledModuleIds: Set<string>
): boolean {
  return (
    manifest.entitlement === "core" || entitledModuleIds.has(manifest.id)
  );
}

/**
 * Calcule l'état d'un module selon la résolution à 3 couches :
 * compilé ∧ autorisé ∧ activé, puis vérifie ses dépendances.
 * Hypothèse : graphe de dépendances acyclique.
 */
export function resolveModuleState(
  manifest: ModuleManifest,
  ctx: EnablementContext,
  allManifests: ModuleManifest[]
): ModuleState {
  const compiled = ctx.compiled.has(manifest.id);
  const entitled = isEntitled(manifest, ctx.entitledModuleIds);
  const toggledOn = ctx.toggles[manifest.id] ?? manifest.defaultEnabled;

  let status: ModuleState["status"];
  if (!compiled) status = "unavailable";
  else if (!entitled) status = "locked";
  else if (!toggledOn) status = "disabled";
  else status = "active";

  let missingDeps: ModuleState["missingDeps"] = [];
  if (status === "active") {
    missingDeps = manifest.dependencies.filter((dep) => {
      const depManifest = allManifests.find((m) => m.id === dep);
      if (!depManifest) return true;
      return (
        resolveModuleState(depManifest, ctx, allManifests).status !== "active"
      );
    });
    if (missingDeps.length > 0) status = "blocked-deps";
  }

  return { id: manifest.id, status, compiled, entitled, toggledOn, missingDeps };
}
