import type { ZodRawShape } from "zod";
import { collectIncludedEnvShape } from "./hooks.env.generated";

/**
 * Point d'extension "env" : feuille du graphe d'imports. Ne doit jamais importer
 * `@/lib/env` ni le baril serveur (cycle), seulement zod et le baril env généré.
 */
export interface EnvHooks {
  /** Variables d'environnement supplémentaires déclarées par les modules inclus. */
  shape: ZodRawShape;
}

export const NEUTRAL_ENV_HOOKS: EnvHooks = { shape: {} };

let current: EnvHooks | null = null;
let barrelLoaded = false;

export function getEnvHooks(): EnvHooks {
  if (!barrelLoaded) {
    barrelLoaded = true;
    current = { shape: { ...NEUTRAL_ENV_HOOKS.shape, ...collectIncludedEnvShape() } };
  }
  return current ?? NEUTRAL_ENV_HOOKS;
}

export function resetEnvHooksForTests(): void {
  barrelLoaded = true;
  current = NEUTRAL_ENV_HOOKS;
}
