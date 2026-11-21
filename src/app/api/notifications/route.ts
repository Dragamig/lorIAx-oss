import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  notifications,
  users,
  documents,
  spaces,
  userDatabases,
} from "@/lib/db/schema";
import { eq, and, desc, or, isNull, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getSpacePermission } from "@/lib/auth/check-access";

// Espace de la base de données d'une notification de ligne (alias distinct de
// celui des documents).
const rowSpaces = alias(spaces, "row_spaces");

// Borne de sécurité du scan des notifications de ligne non lues (comptage).
const ROW_UNREAD_SCAN_CAP = 500;

// Une notification est « globale » (non rattachable à une org) seulement si elle
// n'a ni document ni base de données. Une notification de ligne a documentId nul
// mais databaseId renseigné : elle ne doit jamais passer pour une globale.
interface ScopeFields {
  documentId: string | null;
  databaseId: string | null;
  organizationId: string | null;
  rowOrganizationId: string | null;
  rowSpaceId: string | null;
}

function isVisible(
  r: ScopeFields,
  orgId: string | null,
  permissions: Map<string, boolean>
): boolean {
  const hasDocument = r.documentId != null;
  const hasDatabase = r.databaseId != null;
  if (!hasDocument && !hasDatabase) return true;
  if (!orgId) return false;
  if (hasDocument && r.organizationId !== orgId) return false;
  if (hasDatabase) {
    if (r.rowOrganizationId !== orgId || !r.rowSpaceId) return false;
    if (permissions.get(r.rowSpaceId) !== true) return false;
  }
  return true;
}

// GET — Liste des notifications de l'utilisateur connecté
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 30, 1), 100);

  // Cloisonnement multi-tenant : en multi-org, un compte appartient à plusieurs
  // organisations. Une notification liée à un document n'est visible que si ce
  // document appartient à l'org courante (sous-domaine). Les notifications sans
  // document (non rattachables à une org) restent visibles. `orgId` null
  // (org non résolue / non membre) ⇒ seules les notifications sans document.
  const orgId = await getRequestOrgId(user);
  // Notification de ligne : databaseId renseigné, documentId nul. Elle exige en
  // plus viewer sur l'espace de la base (getSpacePermission, plus bas).
  const isGlobal = and(
    isNull(notifications.documentId),
    isNull(notifications.databaseId)
  );
  const orgScope = orgId
    ? or(
        isGlobal,
        eq(spaces.organizationId, orgId),
        eq(rowSpaces.organizationId, orgId)
      )
    : isGlobal;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      message: notifications.message,
      read: notifications.read,
      createdAt: notifications.createdAt,
      documentId: notifications.documentId,
      databaseId: notifications.databaseId,
      rowId: notifications.rowId,
      actor: {
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      },
      documentTitle: documents.title,
      spaceSlug: spaces.slug,
      organizationId: spaces.organizationId,
      rowOrganizationId: rowSpaces.organizationId,
      rowSpaceId: userDatabases.spaceId,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    .leftJoin(documents, eq(notifications.documentId, documents.id))
    .leftJoin(spaces, eq(documents.spaceId, spaces.id))
    .leftJoin(userDatabases, eq(notifications.databaseId, userDatabases.id))
    .leftJoin(rowSpaces, eq(userDatabases.spaceId, rowSpaces.id))
    .where(and(eq(notifications.userId, user.id), orgScope))
    .orderBy(desc(notifications.createdAt))
    // Sur-échantillonnage : le filtre d'espace (permission) s'applique après la
    // requête ; on charge 2 x limit puis on tronque à `limit` pour ne pas
    // renvoyer de pages courtes quand des notifications de ligne sont masquées.
    .limit(limit * 2);

  // Non lues hors lignes (globales et documents) : compte SQL, comme avant.
  const docScope = orgId
    ? or(isNull(notifications.documentId), eq(spaces.organizationId, orgId))
    : isNull(notifications.documentId);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .leftJoin(documents, eq(notifications.documentId, documents.id))
    .leftJoin(spaces, eq(documents.spaceId, spaces.id))
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.read, false),
        isNull(notifications.databaseId),
        docScope
      )
    );

  // Non lues de ligne : seules celles de l'org courante sont chargées, avec les
  // deux colonnes utiles. Borne de sécurité à ROW_UNREAD_SCAN_CAP : au-delà, le
  // compteur est plafonné (évite de charger un volume non borné à chaque poll).
  const unreadRowNotifs = orgId
    ? await db
        .select({
          databaseId: notifications.databaseId,
          rowSpaceId: userDatabases.spaceId,
        })
        .from(notifications)
        .innerJoin(userDatabases, eq(notifications.databaseId, userDatabases.id))
        .innerJoin(rowSpaces, eq(userDatabases.spaceId, rowSpaces.id))
        .where(
          and(
            eq(notifications.userId, user.id),
            eq(notifications.read, false),
            isNotNull(notifications.databaseId),
            eq(rowSpaces.organizationId, orgId)
          )
        )
        .limit(ROW_UNREAD_SCAN_CAP)
    : [];

  // Une seule vérification de permission par espace distinct (jamais recalculée
  // à la main : getSpacePermission est le seul juge).
  const spaceIds = new Set<string>();
  for (const r of [...rows, ...unreadRowNotifs]) {
    if (r.databaseId != null && r.rowSpaceId) spaceIds.add(r.rowSpaceId);
  }
  const permissions = new Map<string, boolean>();
  await Promise.all(
    [...spaceIds].map(async (spaceId) => {
      const perm = await getSpacePermission(user.id, spaceId);
      permissions.set(spaceId, perm !== null);
    })
  );

  // Défense en profondeur : ne jamais laisser fuiter une notification dont le
  // document ou la base relève d'une autre org, même si le filtre SQL régressait.
  const scoped = rows
    .filter((r) => isVisible(r, orgId, permissions))
    .slice(0, limit);
  // On ne réexpose pas les colonnes internes de cloisonnement.
  const sanitized = scoped.map(
    ({
      organizationId: _org,
      rowOrganizationId: _rowOrg,
      rowSpaceId: _rowSpace,
      ...rest
    }) => rest
  );

  const unreadCount =
    (countRow?.count ?? 0) +
    unreadRowNotifs.filter(
      (r) => r.rowSpaceId && permissions.get(r.rowSpaceId) === true
    ).length;

  return NextResponse.json({ notifications: sanitized, unreadCount });
}

// PATCH — Marquer lu (un ou tous)
export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { notificationId, markAllRead } = body;

  if (markAllRead) {
    await db
      .update(notifications)
      .set({ read: true })
      .where(
        and(eq(notifications.userId, user.id), eq(notifications.read, false))
      );
    return NextResponse.json({ success: true });
  }

  if (!notificationId) {
    return NextResponse.json(
      { error: "notificationId ou markAllRead requis" },
      { status: 400 }
    );
  }

  await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, user.id)
      )
    );

  return NextResponse.json({ success: true });
}
