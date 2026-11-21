import type { NextRequest, NextResponse } from "next/server";
import { collectIncludedHttpHooks } from "./hooks.http.generated";

/**
 * Point d'extension "http" pour `proxy.ts` : feuille du graphe d'imports (aucun
 * accès base, licence ou facturation depuis ce fichier ni son baril).
 */
export interface HttpHooks {
  /** Slug d'organisation déduit de l'hôte ou du chemin, `null` = organisation unique. */
  resolveOrgSlug(host: string, pathname: string): string | null;
  /** Synchronise le cookie d'organisation, renvoie la réponse (neutre : inchangée). */
  syncOrgCookie(req: NextRequest, res: NextResponse): Promise<NextResponse>;
  /** Chemins de pages publiques propres au module (sans session), en plus de ceux du noyau. */
  publicPaths: readonly string[];
}

export const NEUTRAL_HTTP_HOOKS: HttpHooks = {
  resolveOrgSlug: () => null,
  syncOrgCookie: async (_req, res) => res,
  publicPaths: [],
};

let current: HttpHooks | null = null;
let barrelLoaded = false;

export function getHttpHooks(): HttpHooks {
  if (!barrelLoaded) {
    barrelLoaded = true;
    // Une valeur undefined ne doit jamais ecraser le neutre.
    const defined = Object.fromEntries(
      Object.entries(collectIncludedHttpHooks()).filter(([, v]) => v !== undefined),
    ) as Partial<HttpHooks>;
    current = { ...NEUTRAL_HTTP_HOOKS, ...defined };
  }
  return current ?? NEUTRAL_HTTP_HOOKS;
}

export function resetHttpHooksForTests(): void {
  barrelLoaded = true;
  current = NEUTRAL_HTTP_HOOKS;
}
