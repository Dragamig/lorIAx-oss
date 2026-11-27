import { notFound } from "next/navigation"
import { getSessionUser } from "@/lib/auth/get-user"
import { isModuleActive } from "@/lib/modules/enablement"
import { getModuleScopeOrgId } from "@/lib/modules/org-context"
import { raccordementView } from "@/components/crm/raccordement-view"

/** Écran Raccordement (le Pipeline occupe /crm depuis le lot 7). */
export default async function CrmRaccordementPage() {
  const orgId = await getModuleScopeOrgId()
  if (!orgId || !(await isModuleActive("crm", orgId))) notFound()
  const user = await getSessionUser()
  if (!user) notFound()
  return raccordementView(orgId, user)
}
