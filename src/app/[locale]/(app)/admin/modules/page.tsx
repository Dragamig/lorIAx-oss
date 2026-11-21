import { redirect } from "@/i18n/routing";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getModulesState, isModuleActive } from "@/lib/modules/enablement";
import { getUiModuleManifests } from "@/lib/modules/registry";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { db } from "@/lib/db";
import { crmConnections } from "@/lib/db/schema-crm";
import { isCrmOrgAdmin } from "@/lib/crm/access";
import { eq } from "drizzle-orm";
import { ModulesList, type ModuleRow } from "./modules-list";

export default async function AdminModulesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getSessionUser();
  // `redirect` de next-intl n'est pas typé `never` : on rend la sortie explicite
  // pour que la suite de la fonction ne soit jamais atteinte sans session.
  if (!user) return redirect({ href: "/login", locale });
  if (!hasGlobalRole(user.globalRole, "admin")) {
    return redirect({ href: "/admin", locale });
  }

  // Scope organisation : la licence d'instance est un plafond technique, le plan
  // de l'organisation le niveau réellement souscrit. Sans cet argument, l'écran
  // affichait comme disponibles des modules que l'offre de l'organisation exclut.
  const orgId = await getModuleScopeOrgId();
  const manifests = getUiModuleManifests();
  const visibleIds = new Set<string>(manifests.map((m) => m.id));
  const states = (await getModulesState(orgId)).filter((s) => visibleIds.has(s.id));

  const modules: ModuleRow[] = states.map((s) => {
    const m = manifests.find((x) => x.id === s.id)!;
    return {
      id: s.id,
      name: m.name,
      description: m.description,
      category: m.category,
      icon: m.icon,
      configHref: m.configHref,
      healthProbe: m.healthProbe,
      entitlement: m.entitlement,
      manageRole: m.manageRole,
      status: s.status,
      toggledOn: s.toggledOn,
      missingDeps: s.missingDeps.map(
        (dep) => manifests.find((x) => x.id === dep)?.name ?? dep
      ),
    };
  });

  const available = orgId ? await isModuleActive("crm", orgId) : false;
  let enabled = false;
  let canAdminOrg = false;
  if (orgId) {
    const [row] = await db
      .select({ enabled: crmConnections.enabled })
      .from(crmConnections)
      .where(eq(crmConnections.organizationId, orgId))
      .limit(1);
    enabled = row?.enabled === true;
    canAdminOrg = await isCrmOrgAdmin(user, orgId);
  }

  return (
    <div className="p-6 pb-24">
      <ModulesList
        modules={modules}
        crm={{ available, enabled, canAdminOrg }}
        canManageLicensed={hasGlobalRole(user.globalRole, "super_admin")}
      />
    </div>
  );
}
