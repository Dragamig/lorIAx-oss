import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { crmConnections } from "@/lib/db/schema-crm"
import { organizations } from "@/lib/db/schema-org"
import { getSessionUser } from "@/lib/auth/get-user"
import { isCrmOrgAdmin } from "@/lib/crm/access"
import { isModuleActive } from "@/lib/modules/enablement"
import { getModuleScopeOrgId } from "@/lib/modules/org-context"
import { ConnectionScreen } from "@/components/crm/connection-screen"
import { CrmDisabled } from "@/components/crm/crm-disabled"

/** Au lot 6, /crm affiche l'écran Raccordement (le Pipeline du lot 7 le remplacera). */
export default async function CrmPage() {
  const orgId = await getModuleScopeOrgId()
  if (!orgId || !(await isModuleActive("crm", orgId))) notFound()
  const user = await getSessionUser()
  if (!user) notFound()

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
