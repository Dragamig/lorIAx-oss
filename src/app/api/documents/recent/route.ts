import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get("limit") || "10") || 10, 1), 100);

  // Espaces accessibles dans l'org courante (liste autoritative, admins inclus).
  const spaceIds = await getAccessibleSpaceIds(user);
  if (spaceIds.length === 0) return NextResponse.json([]);

  const recentDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      updatedAt: documents.updatedAt,
      spaceSlug: spaces.slug,
      spaceName: spaces.name,
    })
    .from(documents)
    .innerJoin(spaces, eq(documents.spaceId, spaces.id))
    .where(
      and(
        eq(documents.isFolder, false),
        inArray(documents.spaceId, spaceIds)
      )
    )
    .orderBy(desc(documents.updatedAt))
    .limit(limit);

  return NextResponse.json(recentDocs);
}
