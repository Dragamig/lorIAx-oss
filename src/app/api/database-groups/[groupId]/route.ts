import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseGroups } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";

type RouteParams = { params: Promise<{ groupId: string }> };

async function loadGroupSpaceId(groupId: string): Promise<string | null> {
  const [row] = await db
    .select({ spaceId: userDatabaseGroups.spaceId })
    .from(userDatabaseGroups)
    .where(eq(userDatabaseGroups.id, groupId))
    .limit(1);
  return row?.spaceId ?? null;
}

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  icon: z.string().max(64).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const spaceId = await loadGroupSpaceId(groupId);
  if (!spaceId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  try {
    await requireOrgScoped({
      resource: { type: "space", id: spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [updated] = await db
    .update(userDatabaseGroups)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(userDatabaseGroups.id, groupId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const spaceId = await loadGroupSpaceId(groupId);
  if (!spaceId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  try {
    await requireOrgScoped({
      resource: { type: "space", id: spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // FK: les user_databases du groupe ont group_id ON DELETE SET NULL → elles
  // survivent à la suppression du groupe, juste détachées.
  try {
    await db.delete(userDatabaseGroups).where(eq(userDatabaseGroups.id, groupId));
  } catch (err) {
    return NextResponse.json({ error: 'Erreur suppression' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
