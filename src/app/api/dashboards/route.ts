import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("spaceId");
  if (!spaceId) return NextResponse.json({ error: "spaceId requis" }, { status: 400 });
  try {
    await requireOrgScoped({ resource: { type: "space", id: spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  try {
    const result = await db
      .select()
      .from(dashboards)
      .where(eq(dashboards.spaceId, spaceId))
      .orderBy(asc(dashboards.name));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: 'Erreur accès bases' }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  spaceId: z.string().uuid(),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { name, description, spaceId } = parsed.data;
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const [created] = await db
    .insert(dashboards)
    .values({ name, description, spaceId, createdBy: ctx.user.id })
    .returning();
  return NextResponse.json(created, { status: 201 });
}
