import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { asc, eq, inArray } from "drizzle-orm";
import { spaces, dashboards } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { canEditSpace } from "@/lib/auth/can-edit-space";
import { LAST_SPACE_COOKIE, resolveCurrentSpaceId } from "@/lib/spaces/resolve-current-space";
import { DashboardsListClient } from "./dashboards-list-client";

interface PageProps {
  searchParams: Promise<{ spaceId?: string }>;
}

export default async function DashboardsPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("dashboards");

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
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        {t("noSpace")}
      </div>
    );
  }

  const sp = await searchParams;
  // L'espace demandé (URL, puis dernier espace choisi) n'est jamais pris au
  // mot : il doit figurer dans les espaces accessibles, sinon premier espace.
  const lastSpaceId = (await cookies()).get(LAST_SPACE_COOKIE)?.value ?? null;
  const spaceId =
    resolveCurrentSpaceId({
      accessibleIds: userSpaces.map((s) => s.id),
      requested: sp.spaceId,
      lastSpaceId,
    }) ?? userSpaces[0].id;

  const list = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.spaceId, spaceId))
    .orderBy(asc(dashboards.name));

  // Même juge que les écritures de l'API (éditeur sur l'espace) : un lecteur
  // ne se voit pas proposer d'action que l'API refuserait.
  const canEdit = await canEditSpace(spaceId);

  return (
    <DashboardsListClient
      key={spaceId}
      spaceId={spaceId}
      spaces={userSpaces}
      canEdit={canEdit}
      initial={list}
    />
  );
}
