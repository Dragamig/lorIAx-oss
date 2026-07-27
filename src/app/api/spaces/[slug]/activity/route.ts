import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { spaces, activityLog, users, documents } from "@/lib/db/schema";
import { eq, desc, and, or, sql, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  checkSpaceViewAccess,
  buildDocumentVisibilityFilter,
  getSpacePermission,
  isGlobalAdmin,
} from "@/lib/auth/check-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { slug } = await params;
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.slug, slug))
    .limit(1);

  if (!space) {
    return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
  }

  // Le journal d'activite expose les titres des documents de l'espace (metadata.title) :
  // il exige le meme droit de lecture que l'arborescence de l'espace.
  const canView = await checkSpaceViewAccess(user, space.id);
  if (!canView) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");

  // Récupérer les activités liées à cet espace (espace lui-même + documents de l'espace)
  const activities = await db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      metadata: activityLog.metadata,
      createdAt: activityLog.createdAt,
      userId: activityLog.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.userId, users.id))
    .where(
      or(
        and(
          eq(activityLog.entityType, "space"),
          eq(activityLog.entityId, space.id)
        ),
        // Documents de cet espace — on stocke spaceId dans metadata
        and(
          eq(activityLog.entityType, "document"),
          sql`${activityLog.metadata}->>'spaceId' = ${space.id}`
        )
      )
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(limit)
    .offset(offset);

  // Les entrees « document » portent le titre dans `metadata`, et un titre est tres
  // souvent la donnee sensible elle-meme : le journal est filtre par classification,
  // comme l'arborescence de l'espace.
  const documentIds = [
    ...new Set(
      activities
        .filter((a) => a.entityType === "document" && a.entityId)
        .map((a) => a.entityId as string)
    ),
  ];

  const known = new Map<string, { classification: string | null; createdBy: string | null }>();
  if (documentIds.length > 0) {
    const rows = await db
      .select({
        id: documents.id,
        classification: documents.classification,
        createdBy: documents.createdBy,
      })
      .from(documents)
      .where(inArray(documents.id, documentIds));
    for (const row of rows) known.set(row.id, row);
  }

  const isVisible = await buildDocumentVisibilityFilter(user, space.id);

  // Un document supprime ne peut plus etre classe : son entree n'est conservee que
  // pour les membres de l'espace, qui pouvaient deja le voir de son vivant.
  const seesDeletedEntries =
    isGlobalAdmin(user) ||
    space.ownerUserId === user.id ||
    !!(await getSpacePermission(user.id, space.id));

  const visibleActivities = activities.filter((entry) => {
    if (entry.entityType !== "document" || !entry.entityId) return true;
    const doc = known.get(entry.entityId);
    if (!doc) return seesDeletedEntries;
    return isVisible(doc);
  });

  return NextResponse.json(visibleActivities);
}
