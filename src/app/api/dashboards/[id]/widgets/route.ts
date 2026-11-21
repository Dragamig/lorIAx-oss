import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards, dashboardWidgets, userDatabases } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";
import { filterUsesIsMe, DASHBOARD_IS_ME_REJECTED_MESSAGE } from "@/lib/dashboards/is-me";

const widgetSchema = z.object({
  databaseId: z.string().uuid(),
  type: z.enum(["kpi", "bar", "pie"]),
  title: z.string().min(1),
  size: z.enum(["full", "half"]).default("half"),
  config: z.object({
    filter: z.any().nullable(),
    aggregate: z.object({
      fn: z.enum(["count", "sum", "avg", "min", "max", "filled_pct", "unique"]),
      columnId: z.string().optional(),
    }),
    groupBy: z.object({ columnId: z.string() }).optional(),
  }),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  if (!d) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  try {
    await requireOrgScoped({ resource: { type: "space", id: d.spaceId }, minPermission: "editor" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const parsed = widgetSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (filterUsesIsMe(parsed.data.config.filter))
    return NextResponse.json({ error: DASHBOARD_IS_ME_REJECTED_MESSAGE }, { status: 400 });
  // Verify access to source database's space (cross-space security check)
  const [srcDb] = await db
    .select({ spaceId: userDatabases.spaceId })
    .from(userDatabases)
    .where(eq(userDatabases.id, parsed.data.databaseId));
  if (!srcDb) return NextResponse.json({ error: "Base source introuvable" }, { status: 400 });
  try {
    await requireOrgScoped({ resource: { type: "space", id: srcDb.spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${dashboardWidgets.position}), -1)` })
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.dashboardId, id));
  const [created] = await db
    .insert(dashboardWidgets)
    .values({
      dashboardId: id,
      databaseId: parsed.data.databaseId,
      type: parsed.data.type,
      title: parsed.data.title,
      size: parsed.data.size,
      position: Number(max) + 1,
      config: parsed.data.config,
    })
    .returning();
  return NextResponse.json(created, { status: 201 });
}
