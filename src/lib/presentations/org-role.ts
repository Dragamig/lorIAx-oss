import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers } from "@/lib/db/schema-org";

export type OrgMemberRole = "owner" | "admin" | "member";

/**
 * Rôle d'appartenance réel d'un utilisateur dans une organisation, `null` sans
 * ligne `organization_members`. Même sens que `hasOrgMembershipRow` (aucun
 * raccourci pour l'organisation par défaut), avec le rôle en plus.
 */
export async function getOrgMemberRole(
  userId: string,
  orgId: string
): Promise<OrgMemberRole | null> {
  const [row] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}
