import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activityLog, users } from "@/lib/db/schema";
import { eq, desc, and, or, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getSpaceBySlugForRequest } from "@/lib/org/scoped-space";
import { getSpacePermission } from "@/lib/auth/check-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { slug } = await params;
  const space = await getSpaceBySlugForRequest(slug, user);
  if (!space) {
    return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
  }

  // Droit de lecture requis sur l'espace (audit du 2026-08-19, constat
  // AZ-15). L'espace était bien confiné à l'organisation courante, mais aucune
  // permission n'était ensuite exigée : tout membre de l'organisation lisait
  // le fil d'activité d'un espace dont il n'est pas membre, titres de
  // documents et noms des acteurs compris, y compris pour un espace classé
  // secret. Même contrôle que GET /api/spaces/[slug]/documents, la route
  // voisine : getSpacePermission couvre déjà le propriétaire de l'espace et
  // l'admin global (borné à son organisation depuis AZ-06).
  const perm = await getSpacePermission(user.id, space.id);
  if (!perm) {
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

  return NextResponse.json(activities);
}
