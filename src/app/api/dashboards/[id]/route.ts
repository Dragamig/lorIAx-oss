import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards, dashboardWidgets } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";

async function loadDashboard(id: string) {
  const [d] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  return d ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadDashboard(id);
  if (!d) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  try {
    await requireOrgScoped({ resource: { type: "space", id: d.spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const widgets = await db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.dashboardId, id))
    .orderBy(asc(dashboardWidgets.position));
  return NextResponse.json({ ...d, widgets });
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  widgetOrder: z.array(z.string().uuid()).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadDashboard(id);
  if (!d) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  try {
    await requireOrgScoped({ resource: { type: "space", id: d.spaceId }, minPermission: "editor" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { name, description, widgetOrder } = parsed.data;
  if (name !== undefined || description !== undefined) {
    await db
      .update(dashboards)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(dashboards.id, id));
  }
  if (widgetOrder) {
    for (let i = 0; i < widgetOrder.length; i++) {
      await db
        .update(dashboardWidgets)
        .set({ position: i, updatedAt: new Date() })
        .where(
          and(
            eq(dashboardWidgets.id, widgetOrder[i]),
            eq(dashboardWidgets.dashboardId, id)
          )
        );
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadDashboard(id);
  if (!d) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  try {
    await requireOrgScoped({ resource: { type: "space", id: d.spaceId }, minPermission: "editor" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  await db.delete(dashboards).where(eq(dashboards.id, id));
  return NextResponse.json({ ok: true });
}
