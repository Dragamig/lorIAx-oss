import { db } from "@/lib/db";
import { organizations, organizationMembers } from "@/lib/db/schema-org";
import { eq, and } from "drizzle-orm";
import { hasGlobalRole } from "@/lib/auth/rbac";
import type { SessionUser } from "@/types";

export interface OrgAdminContext {
  orgId: string;
  callerRole: "owner" | "admin" | "super_admin";
}

/**
 * Retourne l'org et le rôle de l'appelant si `user` peut l'administrer
 * (membership owner/admin OU super_admin global), sinon null (org introuvable
 * ou non autorisé). `callerRole` permet d'appliquer des règles d'autorisation
 * plus fines en aval (ex. octroi du rôle owner réservé aux owners).
 */
export async function resolveOrgAdmin(
  user: SessionUser,
  slug: string
): Promise<OrgAdminContext | null> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!org) return null;

  if (hasGlobalRole(user.globalRole, "super_admin"))
    return { orgId: org.id, callerRole: "super_admin" };

  const [m] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user.id)
      )
    )
    .limit(1);

  if (m && (m.role === "owner" || m.role === "admin"))
    return { orgId: org.id, callerRole: m.role };
  return null;
}
