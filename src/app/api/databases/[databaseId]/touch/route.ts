import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseRecents } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;

  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "viewer",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  await db
    .insert(userDatabaseRecents)
    .values({ userId: ctx.user.id, databaseId, openedAt: new Date() })
    .onConflictDoUpdate({
      target: [userDatabaseRecents.userId, userDatabaseRecents.databaseId],
      set: { openedAt: sql`now()` },
    });

  return NextResponse.json({ ok: true });
}
