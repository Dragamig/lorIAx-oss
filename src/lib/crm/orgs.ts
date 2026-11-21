import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers, organizations } from "@/lib/db/schema-org";
import { guardModuleEnabled } from "@/lib/modules/guard";
import { isCrmOrgAdmin } from "./access";

/**
 * Organisations proposées par la modale d'activation : celles où l'utilisateur a une vraie ligne
 * d'appartenance (super_admin compris, jamais toutes les organisations de l'instance), où il
 * administre le CRM (`isCrmOrgAdmin`) et où le module est actif. Les identifiants ne sortent pas.
 */
export async function listCrmAdminOrgs(user: {
  id: string;
  globalRole: string;
}): Promise<{ slug: string; name: string }[]> {
  const rows = await db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, user.id))
    .orderBy(asc(organizations.name));

  const kept: { slug: string; name: string }[] = [];
  for (const row of rows) {
    if (!(await isCrmOrgAdmin(user, row.id))) continue;
    if (await guardModuleEnabled("crm", row.id)) continue;
    kept.push({ slug: row.slug, name: row.name });
  }
  return kept;
}
