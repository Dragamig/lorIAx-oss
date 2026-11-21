/**
 * Encadrement (iframe) des réponses : refusé partout, sauf la lecture d'un
 * média (`/api/media/<id>`) par la même origine, pour l'aperçu PDF de la
 * médiathèque. L'alias permanent `/api/attachments/<clé>` n'est volontairement
 * pas encadrable (sa branche de repli sans ligne media ne passe pas par
 * `serveMediaObject`) : l'aperçu passe par l'ID. Partagé par `next.config.ts` (X-Frame-Options) et `proxy.ts` (CSP).
 */
export const MEDIA_READ_RE = /^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMediaReadPath(pathname: string): boolean {
  return MEDIA_READ_RE.test(pathname);
}

type Rule = { source: string; headers: { key: string; value: string }[] };

/** Règles X-Frame-Options : l'exclusion de la lecture des médias évite deux valeurs concurrentes. */
export function frameHeaderRules(): Rule[] {
  return [
    { source: "/api/media/:id([0-9a-fA-F-]{36})", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
    { source: "/((?!api/media/[0-9a-fA-F-]{36}$).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
  ];
}
