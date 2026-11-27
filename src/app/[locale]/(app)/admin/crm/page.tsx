import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/get-user"
import { hasGlobalRole } from "@/lib/auth/rbac"
import { isModuleActive } from "@/lib/modules/enablement"
import { getModuleScopeOrgId } from "@/lib/modules/org-context"
import { BackToServices } from "@/components/admin/back-to-services"
import { ModuleActivationNotice } from "@/components/admin/module-activation-notice"
import { raccordementView } from "@/components/crm/raccordement-view"

/** Configuration du CRM dans l'administration : même contenu que le menu CRM > Raccordement. */
export default async function AdminCrmPage() {
  const user = await getSessionUser()
  if (!user || !hasGlobalRole(user.globalRole, "admin")) redirect("/")
  const orgId = await getModuleScopeOrgId()
  const active = orgId ? await isModuleActive("crm", orgId) : false

  return (
    <div className="space-y-6 pb-24">
      <BackToServices />
      <ModuleActivationNotice enabled={active} moduleName="CRM" />
      {orgId && active ? await raccordementView(orgId, user) : null}
    </div>
  )
}
