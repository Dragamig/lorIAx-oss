import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isPresentationsModuleActive } from "@/lib/presentations/guards";
import { getTranslations } from "next-intl/server";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { OrgScopeError, requireOrgScoped } from "@/lib/auth/require-org-scoped";
import { resolveTemplateRights } from "@/lib/presentations/template-access";
import { canEditSpace } from "@/lib/auth/can-edit-space";
import { LAST_SPACE_COOKIE, resolveCurrentSpaceId } from "@/lib/spaces/resolve-current-space";
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
  // L'espace demandé (URL, puis dernier espace choisi) n'est jamais pris au
  // mot : il doit figurer dans les espaces accessibles, sinon le premier.
  const lastSpaceId = (await cookies()).get(LAST_SPACE_COOKIE)?.value ?? null;
  const spaceId =
    resolveCurrentSpaceId({
      accessibleIds: userSpaces.map((s) => s.id),
      requested: sp.spaceId,
      lastSpaceId,
    }) ?? userSpaces[0].id;

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
  const canDelete = await canEditSpace(spaceId);

  return (
    <PresentationsListClient
      spaceId={spaceId}
      spaces={userSpaces}
      isAdmin={canManage}
      canDelete={canDelete}
    />
  );
}
