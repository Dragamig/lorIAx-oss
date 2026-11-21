import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards, dashboardWidgets, userDatabases } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";
import { filterUsesIsMe, DASHBOARD_IS_ME_REJECTED_MESSAGE } from "@/lib/dashboards/is-me";
import type { WidgetConfig } from "@/lib/dashboards/types";

async function authForWidget(dashboardId: string) {
  const [d] = await db.select().from(dashboards).where(eq(dashboards.id, dashboardId));
  if (!d) return { error: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
  try {
    await requireOrgScoped({
      resource: { type: "space", id: d.spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return { error: e.response };
    throw e;
  }
  return { error: null };
}

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  size: z.enum(["full", "half"]).optional(),
  databaseId: z.string().uuid().optional(),
  config: z
    .object({
      filter: z.any().nullable(),
      aggregate: z.object({
        fn: z.enum(["count", "sum", "avg", "min", "max", "filled_pct", "unique"]),
        columnId: z.string().optional(),
      }),
      groupBy: z.object({ columnId: z.string() }).optional(),
    })
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; widgetId: string }> }
) {
  const { id, widgetId } = await params;
  const { error } = await authForWidget(id);
  if (error) return error;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (filterUsesIsMe(parsed.data.config?.filter))
    return NextResponse.json({ error: DASHBOARD_IS_ME_REJECTED_MESSAGE }, { status: 400 });
  if (parsed.data.databaseId) {
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
  }
  // Build set object only with defined fields to avoid Drizzle type issues
  const setValues: {
    updatedAt: Date;
    title?: string;
    size?: string;
    databaseId?: string;
    config?: WidgetConfig;
  } = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) setValues.title = parsed.data.title;
  if (parsed.data.size !== undefined) setValues.size = parsed.data.size;
  if (parsed.data.databaseId !== undefined) setValues.databaseId = parsed.data.databaseId;
  if (parsed.data.config !== undefined) setValues.config = parsed.data.config as WidgetConfig;
  await db
    .update(dashboardWidgets)
    .set(setValues)
    .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, id)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; widgetId: string }> }
) {
  const { id, widgetId } = await params;
  const { error } = await authForWidget(id);
  if (error) return error;
  await db
    .delete(dashboardWidgets)
    .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, id)));
  return NextResponse.json({ ok: true });
}
