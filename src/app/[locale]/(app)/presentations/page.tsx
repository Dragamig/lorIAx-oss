import { notFound, redirect } from "next/navigation";
import { isPresentationsModuleActive } from "@/lib/presentations/guards";
import { getTranslations } from "next-intl/server";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { OrgScopeError, requireOrgScoped } from "@/lib/auth/require-org-scoped";
import { resolveTemplateRights } from "@/lib/presentations/template-access";
import { PresentationsListClient } from "./presentations-list-client";

interface PageProps {
  searchParams: Promise<{ spaceId?: string }>;
}

export default async function PresentationsPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Module coupé : la page n'existe plus, elle ne se contente pas de se vider.
  if (!(await isPresentationsModuleActive(user))) notFound();

  const t = await getTranslations("presentations");

  const accessibleIds = await getAccessibleSpaceIds(user);

  const userSpaces =
    accessibleIds.length === 0
      ? []
      : await db
          .select({ id: spaces.id, name: spaces.name })
          .from(spaces)
          .where(inArray(spaces.id, accessibleIds))
          .orderBy(asc(spaces.name));

  if (userSpaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("noSpace")}
      </div>
    );
  }

  const sp = await searchParams;
  // L'espace demandé n'est jamais pris au mot : il doit figurer dans les
  // espaces accessibles, sinon on retombe sur le premier.
  const requestedSpaceId = sp.spaceId;
  const spaceId =
    requestedSpaceId && userSpaces.some((s) => s.id === requestedSpaceId)
      ? requestedSpaceId
      : userSpaces[0].id;

  // Gérer les modèles : borné à l'appartenance à l'organisation courante.
  let orgId: string;
  try {
    ({ orgId } = await requireOrgScoped());
  } catch (e) {
    if (e instanceof OrgScopeError) notFound();
    throw e;
  }
  const { canManage } = await resolveTemplateRights(user, orgId);

  // Supprimer exige le droit d'éditeur sur l'espace, comme le DELETE de l'API.
  let canDelete = true;
  try {
    await requireOrgScoped({ resource: { type: "space", id: spaceId }, minPermission: "editor" });
  } catch (e) {
    if (!(e instanceof OrgScopeError)) throw e;
    canDelete = false;
  }

  return <PresentationsListClient spaceId={spaceId} isAdmin={canManage} canDelete={canDelete} />;
}
