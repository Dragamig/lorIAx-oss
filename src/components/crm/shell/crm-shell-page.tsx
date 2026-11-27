import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { getTranslations } from "next-intl/server"
import { db } from "@/lib/db"
import { crmConnections } from "@/lib/db/schema-crm"
import { organizations } from "@/lib/db/schema-org"
import { getSessionUser } from "@/lib/auth/get-user"
import { isCrmOrgAdmin } from "@/lib/crm/access"
import type { CrmRole } from "@/lib/crm/fields"
import { isModuleActive } from "@/lib/modules/enablement"
import { getModuleScopeOrgId } from "@/lib/modules/org-context"
import { CrmDisabled } from "@/components/crm/crm-disabled"
import { CrmScreen } from "./crm-screen"

const ROLE_OF = { relances: "dossiers", dossiers: "dossiers", contacts: "contacts" } as const satisfies Record<string, CrmRole>

/** Coquille d'écran CRM : même garde que /crm, contenu remplacé par chaque tâche d'écran. */
export async function CrmShellPage({ screen, children }: { screen: keyof typeof ROLE_OF; children?: React.ReactNode }) {
  const orgId = await getModuleScopeOrgId()
  if (!orgId || !(await isModuleActive("crm", orgId))) notFound()
  const user = await getSessionUser()
  if (!user) notFound()

  const [conn] = await db
    .select({ enabled: crmConnections.enabled })
    .from(crmConnections)
    .where(eq(crmConnections.organizationId, orgId))
    .limit(1)
  if (conn?.enabled !== true) {
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1)
    const isAdmin = await isCrmOrgAdmin(user, orgId)
    return <CrmDisabled organisationName={org?.name ?? ""} isAdmin={isAdmin} />
  }

  if (children) return <>{children}</>
  const t = await getTranslations("crm")
  return <CrmScreen title={t("nav.crm")} role={ROLE_OF[screen]} state="ready" />
}
