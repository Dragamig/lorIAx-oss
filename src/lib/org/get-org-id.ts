/**
 * Résolution d'organisation SANS session.
 *
 * Ce module portait `getOrgId`, qui traduisait un slug d'organisation en
 * identifiant sans contrôler aucune appartenance. Le slug vient du header
 * `x-org-slug`, réécrit par le proxy depuis l'hôte de la requête, et le cookie
 * de session est valide sur tous les sous-domaines : appelé depuis une route
 * authentifiée, ce helper laissait un membre d'un tenant agir sur les données
 * d'un autre (audit du 2026-08-19, constats P0-6, AZ-02, AZ-12, INJ-23, puis la
 * création d'espace dans un tenant tiers trouvée pendant le lot 2).
 *
 * `getOrgId` et `getOrgSlugFromHeaders` ont été retirés le 2026-08-20, une fois
 * leur dernier appelant authentifié basculé. Le helper n'est plus disponible :
 * la classe de défauts est fermée par l'absence de l'outil, pas seulement par
 * la discipline de ses appelants. Ne les réintroduisez pas.
 *
 * Pour toute route ou tout composant serveur AUTHENTIFIÉ, utiliser :
 * - `requireOrgScoped` (`@/lib/auth/require-org-scoped`) : appartenance à
 *   l'organisation ET seuil de permission sur la ressource, erreur typée à
 *   renvoyer telle quelle ;
 * - `resolveRequestOrg` / `getRequestOrgId` (`@/lib/org/resolve-request-org`,
 *   `@/lib/org/get-request-org`) : résolution seule, avec contrôle
 *   d'appartenance, `null` = aucun accès (fail-closed), à traduire en 404.
 */

import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

/**
 * Identifiant de l'organisation partagée par défaut, c'est-à-dire la première
 * organisation active. C'est le tenant mutualisé historique, servi sur l'apex
 * et sur `www`, et il n'y en a qu'une en mode mono-tenant.
 *
 * Ne dépend d'aucune entrée de la requête : rien à contrôler, donc utilisable
 * dans les contextes sans session (assistant d'installation, synchronisation
 * LDAP, tâches de fond) comme dans les résolveurs cloisonnés.
 */
export async function getDefaultOrgId(): Promise<string> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.isActive, true))
    .orderBy(asc(organizations.createdAt))
    .limit(1);

  if (!org) throw new Error("Aucune organisation active trouvée");
  return org.id;
}
