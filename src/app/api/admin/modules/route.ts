import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getModulesState } from "@/lib/modules/enablement";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";
import { getUiModuleManifests } from "@/lib/modules/registry";

export async function GET() {
  const user = await getSessionUser();
  // Lecture seule, alignée sur la page /admin/modules et sur le PATCH : un admin
  // voit l'inventaire, le contrôle par module (manageRole) reste sur l'écriture.
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  // Même scope que la page et que le PATCH : sans orgId, la route publierait un
  // état ignorant l'offre de l'organisation, en contradiction avec l'interface.
  const orgId = await getModuleScopeOrgId();
  const manifests = getUiModuleManifests();
  const visibleIds = new Set<string>(manifests.map((m) => m.id));
  const states = (await getModulesState(orgId)).filter((s) => visibleIds.has(s.id));
  const modules = states.map((s) => {
    const m = manifests.find((x) => x.id === s.id)!;
    return {
      id: s.id,
      name: m.name,
      description: m.description,
      dependencies: m.dependencies,
      entitlement: m.entitlement,
      status: s.status,
      compiled: s.compiled,
      entitled: s.entitled,
      toggledOn: s.toggledOn,
      missingDeps: s.missingDeps,
    };
  });
  return NextResponse.json({ modules });
}
