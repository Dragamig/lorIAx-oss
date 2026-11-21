import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { dashboards, dashboardWidgets, userDatabases } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { DashboardClient } from "./dashboard-client";
import type { DashboardWidgetDef } from "@/lib/dashboards/types";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const [d] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  if (!d) notFound();

  // Cloisonnement : l'espace du dashboard doit appartenir à l'org courante.
  // Vaut aussi pour les admins (pas d'accès cross-org).
  const ids = await getAccessibleSpaceIds(user);
  if (!ids.includes(d.spaceId)) notFound();

  const widgets = await db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.dashboardId, id))
    .orderBy(asc(dashboardWidgets.position));

  const bases = await db
    .select({ id: userDatabases.id, name: userDatabases.name })
    .from(userDatabases)
    .where(eq(userDatabases.spaceId, d.spaceId))
    .orderBy(asc(userDatabases.name));

  return (
    <DashboardClient
      dashboard={d}
      initialWidgets={widgets as DashboardWidgetDef[]}
      bases={bases}
    />
  );
}
