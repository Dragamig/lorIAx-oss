import { db } from "@/lib/db";
import { organizationMembers } from "@/lib/db/schema-org";
import { eq } from "drizzle-orm";

/**
 * Identifiants des utilisateurs membres d'une organisation.
 *
 * Brique de cloisonnement des listings : toute requête qui énumère des
 * utilisateurs doit intersecter ses résultats avec ces identifiants afin de ne
 * jamais exposer un membre d'une autre organisation (y compris via le tenant
 * mutualisé `app`). Un utilisateur sans ligne `organization_members` (compte
 * service orphelin) n'appartient à aucune org et est donc exclu — comportement
 * volontaire : il ne doit apparaître dans aucun annuaire.
 */
export async function getOrgMemberIds(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, orgId));

  return rows.map((r) => r.userId);
}
