/**
 * URL de bascule vers une organisation.
 * Prod (mode sous-domaine, NEXT_PUBLIC_ROOT_DOMAIN défini) → https://{slug}.{ROOT_DOMAIN}
 * Dev/local → chemin /org/{slug} (le middleware résout aussi ce mode).
 */
export function buildOrgUrl(slug: string): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  if (root) return `https://${slug}.${root}`;
  return `/org/${slug}`;
}
