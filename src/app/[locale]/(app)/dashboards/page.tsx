import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { asc, eq, inArray } from "drizzle-orm";
import { spaces, dashboards } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
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
  const requestedSpaceId = sp.spaceId;
  const spaceId =
    requestedSpaceId && userSpaces.some((s) => s.id === requestedSpaceId)
      ? requestedSpaceId
      : userSpaces[0].id;

  const list = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.spaceId, spaceId))
    .orderBy(asc(dashboards.name));

  return <DashboardsListClient spaceId={spaceId} initial={list} />;
}
