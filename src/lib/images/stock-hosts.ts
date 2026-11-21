/**
 * Hôtes de téléchargement des banques d'images intégrées (Unsplash, Pexels,
 * Pixabay), sous-domaines compris. Seule liste qui autorise l'origine `stock`
 * d'un import distant : un fournisseur ajouté dans `adapters.ts` doit l'être ici.
 */
export const STOCK_IMAGE_HOSTS = [
  "images.unsplash.com",
  "images.pexels.com",
  "pixabay.com",
] as const;

export function isStockImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return STOCK_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
