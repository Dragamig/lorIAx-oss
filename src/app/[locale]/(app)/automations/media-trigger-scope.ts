export type MediaTriggerScope = "any" | "orphan" | "space";

/** Portée lue dans la config du déclencheur « média ajouté » (défaut : tout). */
export function mediaTriggerScope(config: Record<string, unknown>): MediaTriggerScope {
  return config.scope === "orphan" || config.scope === "space" ? config.scope : "any";
}

/** Clé du namespace `mediaTrigger` qui sert de sous-titre à la carte du déclencheur. */
export function mediaTriggerSubtitleKey(config: Record<string, unknown>): "scopeAny" | "scopeOrphan" | "scopeSpace" {
  const scope = mediaTriggerScope(config);
  return scope === "orphan" ? "scopeOrphan" : scope === "space" ? "scopeSpace" : "scopeAny";
}
