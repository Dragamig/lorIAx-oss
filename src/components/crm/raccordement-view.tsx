import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { crmConnections } from "@/lib/db/schema-crm"
import { organizations } from "@/lib/db/schema-org"
import { isCrmOrgAdmin } from "@/lib/crm/access"
import { ConnectionScreen } from "@/components/crm/connection-screen"
import { CrmDisabled } from "@/components/crm/crm-disabled"

/**
 * Contenu de l'écran Raccordement, partagé entre la page du menu CRM et la page
 * de configuration de l'administration.
 */
export async function raccordementView(orgId: string, user: Parameters<typeof isCrmOrgAdmin>[0]) {
  const [conn] = await db
    .select({ enabled: crmConnections.enabled })
    .from(crmConnections)
    .where(eq(crmConnections.organizationId, orgId))
    .limit(1)
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  const organisationName = org?.name ?? ""

  if (conn?.enabled !== true) {
    const isAdmin = await isCrmOrgAdmin(user, orgId)
    return <CrmDisabled organisationName={organisationName} isAdmin={isAdmin} />
  }
  return <ConnectionScreen organisation={organisationName} />
}
