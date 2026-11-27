import { redirect } from "@/i18n/routing"
import { getLocale } from "next-intl/server"
import { getSessionUser } from "@/lib/auth/get-user"
import { hasGlobalRole } from "@/lib/auth/rbac"
import { isOrgAdminOrOwner } from "@/lib/media/access"
import { isModuleActive } from "@/lib/modules/enablement"
import { getModuleScopeOrgId } from "@/lib/modules/org-context"
import { LibraryPage } from "@/components/media/library-page"

export default async function MediathequePage() {
  const orgId = await getModuleScopeOrgId()
  if (!(await isModuleActive("library", orgId))) {
    redirect({ href: "/", locale: await getLocale() })
  }
  const user = await getSessionUser()
  const isAdmin = user && orgId ? await isOrgAdminOrOwner(user.id, orgId) : false
  const canWrite = user ? hasGlobalRole(user.globalRole, "editor") : false
  return <LibraryPage isAdmin={isAdmin} canWrite={canWrite} userId={user?.id} />
}
