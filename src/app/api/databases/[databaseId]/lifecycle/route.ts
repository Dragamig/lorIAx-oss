import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";

const bodySchema = z.object({
  action: z.enum(["archive", "unarchive", "trash", "restore"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;

  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const now = new Date();
    const patch: Partial<typeof userDatabases.$inferInsert> = { updatedAt: now };
    switch (parsed.data.action) {
      case "archive":
        patch.archivedAt = now;
        patch.deletedAt = null;
        break;
      case "unarchive":
        patch.archivedAt = null;
        break;
      case "trash":
        patch.deletedAt = now;
        break;
      case "restore":
        patch.deletedAt = null;
        patch.archivedAt = null;
        break;
    }

    const [updated] = await db
      .update(userDatabases)
      .set(patch)
      .where(eq(userDatabases.id, databaseId))
      .returning();

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
}
