import { registerHooks } from "../hooks";

// Usage correct : registerHooks dans le corps de la fonction, jamais au niveau supérieur.
export function registerIncludedModuleHooks(): void {
  registerHooks({ usage: { getOrgStorageLimitBytes: async () => 7 } as never });
}
