import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseGroups } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("spaceId");
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId requis" }, { status: 400 });
  }

  try {
    await requireOrgScoped({ resource: { type: "space", id: spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const groups = await db
    .select()
    .from(userDatabaseGroups)
    .where(eq(userDatabaseGroups.spaceId, spaceId))
    .orderBy(userDatabaseGroups.position, userDatabaseGroups.name);

  return NextResponse.json(groups);
}

const createSchema = z.object({
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  icon: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: parsed.data.spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const [maxPos] = await db
    .select({ max: sql<number>`COALESCE(MAX(${userDatabaseGroups.position}), -1)` })
    .from(userDatabaseGroups)
    .where(eq(userDatabaseGroups.spaceId, parsed.data.spaceId));

  const [group] = await db
    .insert(userDatabaseGroups)
    .values({
      spaceId: parsed.data.spaceId,
      name: parsed.data.name,
      icon: parsed.data.icon,
      position: (maxPos?.max ?? -1) + 1,
      createdBy: ctx.user.id,
    })
    .returning();

  return NextResponse.json(group, { status: 201 });
}
