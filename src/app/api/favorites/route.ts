import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  favorites,
  documents,
  spaces,
  templates,
  calendarEvents,
  meetings,
  userDatabases,
} from "@/lib/db/schema";
import { eq, and, inArray, asc, sql, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  getAccessibleSpaceIds,
  checkDocumentViewAccess,
  checkSpaceReadAccess,
} from "@/lib/auth/check-access";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import type { SessionUser } from "@/types";

const VALID_ENTITY_TYPES = [
  "document",
  "space",
  "template",
  "calendar_event",
  "meeting",
  "database",
] as const;

type EntityType = (typeof VALID_ENTITY_TYPES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedFavorite {
  id: string;
  title?: string;
  entityType: EntityType;
  entityId: string;
  position: number;
  label: string;
  icon: string | null;
  href: string;
  badge: string;
  subtitle: string | null;
}

/**
 * Vérifie qu'un utilisateur a bien accès à l'entité qu'il veut mettre en favori.
 *
 * `entityId` est fourni par le client : sans ce contrôle, un UUID forgé permet
 * d'enregistrer (et de faire résoudre par le GET) une entité d'un espace ou
 * d'une organisation auxquels l'utilisateur n'a pas accès.
 */
async function checkEntityAccess(
  user: SessionUser,
  entityType: EntityType,
  entityId: string
): Promise<"ok" | "forbidden" | "not-found"> {
  switch (entityType) {
    case "document": {
      const [doc] = await db
        .select({ spaceId: documents.spaceId })
        .from(documents)
        .where(eq(documents.id, entityId))
        .limit(1);
      if (!doc) return "not-found";
      return (await checkDocumentViewAccess(user, doc.spaceId, entityId))
        ? "ok"
        : "forbidden";
    }
    case "space": {
      const [space] = await db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.id, entityId))
        .limit(1);
      if (!space) return "not-found";
      return (await checkSpaceReadAccess(user, entityId)) ? "ok" : "forbidden";
    }
    case "template": {
      const [tmpl] = await db
        .select({ isGlobal: templates.isGlobal, spaceId: templates.spaceId })
        .from(templates)
        .where(eq(templates.id, entityId))
        .limit(1);
      if (!tmpl) return "not-found";
      // Modèles globaux / sans espace : org-neutres, comme au GET.
      if (tmpl.isGlobal || !tmpl.spaceId) return "ok";
      return (await checkSpaceReadAccess(user, tmpl.spaceId)) ? "ok" : "forbidden";
    }
    case "calendar_event": {
      const [evt] = await db
        .select({ calendarId: calendarEvents.calendarId })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, entityId))
        .limit(1);
      if (!evt) return "not-found";
      // Cloisonnement : l'organisation de la requête est explicite, et un
      // `null` (org non résolue) vaut refus.
      return (await checkCalendarAccess(user.id, evt.calendarId, "read", await getRequestOrgId(user)))
        ? "ok"
        : "forbidden";
    }
    case "meeting": {
      const [mtg] = await db
        .select({ spaceId: meetings.spaceId })
        .from(meetings)
        .where(eq(meetings.id, entityId))
        .limit(1);
      if (!mtg) return "not-found";
      // Réunion autonome (sans espace) : org-neutre, comme au GET.
      if (!mtg.spaceId) return "ok";
      return (await checkSpaceReadAccess(user, mtg.spaceId)) ? "ok" : "forbidden";
    }
    case "database": {
      const [row] = await db
        .select({ spaceId: userDatabases.spaceId })
        .from(userDatabases)
        .where(eq(userDatabases.id, entityId))
        .limit(1);
      if (!row) return "not-found";
      return (await checkSpaceReadAccess(user, row.spaceId)) ? "ok" : "forbidden";
    }
    default:
      return "forbidden";
  }
}

// ─── GET /api/favorites ────────────────────────────────────────────────────────

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json([], { status: 401 });

  // 1. Fetch all favorites for the user, ordered by position
  const userFavorites = await db
    .select()
    .from(favorites)
    .where(eq(favorites.userId, user.id))
    .orderBy(asc(favorites.position));

  if (userFavorites.length === 0) {
    return NextResponse.json([]);
  }

  // 2. Group entity IDs by type
  const idsByType = new Map<EntityType, string[]>();
  for (const fav of userFavorites) {
    const type = fav.entityType as EntityType;
    if (!idsByType.has(type)) idsByType.set(type, []);
    idsByType.get(type)!.push(fav.entityId);
  }

  // 3. Batch-resolve entities
  const resolved = new Map<string, ResolvedFavorite>();

  // ── Documents ──
  const docIds = idsByType.get("document");
  if (docIds?.length) {
    const docs = await db
      .select({
        id: documents.id,
        title: documents.title,
        slug: documents.slug,
        icon: documents.icon,
        spaceId: documents.spaceId,
        spaceSlug: spaces.slug,
        spaceName: spaces.name,
      })
      .from(documents)
      .innerJoin(spaces, eq(documents.spaceId, spaces.id))
      .where(inArray(documents.id, docIds));

    for (const doc of docs) {
      resolved.set(doc.id, {
        id: "", // filled later
        entityType: "document",
        entityId: doc.id,
        position: 0,
        label: doc.title,
        icon: doc.icon,
        href: `/s/${doc.spaceSlug}/${doc.id}`,
        badge: "Document",
        subtitle: doc.spaceName,
      });
    }
  }

  // ── Spaces ──
  const spaceIds = idsByType.get("space");
  if (spaceIds?.length) {
    const spaceRows = await db
      .select({
        id: spaces.id,
        name: spaces.name,
        slug: spaces.slug,
        icon: spaces.icon,
        type: spaces.type,
      })
      .from(spaces)
      .where(inArray(spaces.id, spaceIds));

    const typeLabels: Record<string, string> = {
      personal: "Personnel",
      team: "Équipe",
      organization: "Organisation",
    };

    for (const space of spaceRows) {
      resolved.set(space.id, {
        id: "",
        entityType: "space",
        entityId: space.id,
        position: 0,
        label: space.name,
        icon: space.icon,
        href: `/s/${space.slug}`,
        badge: "Espace",
        subtitle: typeLabels[space.type] ?? space.type,
      });
    }
  }

  // ── Templates ──
  const templateIds = idsByType.get("template");
  if (templateIds?.length) {
    const templateRows = await db
      .select({
        id: templates.id,
        name: templates.name,
        icon: templates.icon,
        category: templates.category,
      })
      .from(templates)
      .where(inArray(templates.id, templateIds));

    for (const tmpl of templateRows) {
      resolved.set(tmpl.id, {
        id: "",
        entityType: "template",
        entityId: tmpl.id,
        position: 0,
        label: tmpl.name,
        icon: tmpl.icon,
        href: `/new?template=${tmpl.id}`,
        badge: "Modèle",
        subtitle: tmpl.category,
      });
    }
  }

  // ── Calendar events ──
  const eventIds = idsByType.get("calendar_event");
  if (eventIds?.length) {
    const eventRows = await db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        startAt: calendarEvents.startAt,
      })
      .from(calendarEvents)
      .where(inArray(calendarEvents.id, eventIds));

    for (const evt of eventRows) {
      resolved.set(evt.id, {
        id: "",
        entityType: "calendar_event",
        entityId: evt.id,
        position: 0,
        label: evt.title,
        icon: null,
        href: "/calendar",
        badge: "Événement",
        subtitle: evt.startAt
          ? new Intl.DateTimeFormat("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(evt.startAt))
          : null,
      });
    }
  }

  // ── Meetings ──
  const meetingIds = idsByType.get("meeting");
  if (meetingIds?.length) {
    const meetingRows = await db
      .select({
        id: meetings.id,
        title: meetings.title,
        startedAt: meetings.startedAt,
      })
      .from(meetings)
      .where(inArray(meetings.id, meetingIds));

    for (const mtg of meetingRows) {
      resolved.set(mtg.id, {
        id: "",
        entityType: "meeting",
        entityId: mtg.id,
        position: 0,
        label: mtg.title,
        icon: null,
        href: "/meet",
        badge: "Réunion",
        subtitle: mtg.startedAt
          ? new Intl.DateTimeFormat("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(mtg.startedAt))
          : null,
      });
    }
  }

  // ── Databases (bases) ──
  const databaseIds = idsByType.get("database");
  const databaseSpaceById = new Map<string, string>();
  if (databaseIds?.length) {
    const databaseRows = await db
      .select({
        id: userDatabases.id,
        name: userDatabases.name,
        spaceId: userDatabases.spaceId,
      })
      .from(userDatabases)
      .where(
        and(inArray(userDatabases.id, databaseIds), isNull(userDatabases.deletedAt))
      );

    for (const base of databaseRows) {
      databaseSpaceById.set(base.id, base.spaceId);
      resolved.set(base.id, {
        id: "",
        entityType: "database",
        entityId: base.id,
        position: 0,
        label: base.name,
        icon: null,
        href: `/bases/${base.id}`,
        badge: "Base",
        subtitle: null,
      });
    }
  }

  // 4. RBAC filtering — remove entities the user can no longer access.
  // Cloisonnement multi-tenant : la liste des espaces accessibles est scopée
  // sur l'org courante (admins inclus) ; un favori pointant vers une autre org
  // est retiré.
  const accessibleSpaceIdSet = new Set(await getAccessibleSpaceIds(user));

  // For documents: filter by accessible space IDs
  if (docIds?.length) {
    const docs = await db
      .select({ id: documents.id, spaceId: documents.spaceId })
      .from(documents)
      .where(inArray(documents.id, docIds));

    for (const doc of docs) {
      if (!accessibleSpaceIdSet.has(doc.spaceId)) {
        resolved.delete(doc.id);
      }
    }
  }

  // For spaces: filter by accessible space IDs
  if (spaceIds?.length) {
    for (const id of spaceIds) {
      if (!accessibleSpaceIdSet.has(id)) {
        resolved.delete(id);
      }
    }
  }

  // Bases: filtrées sur les espaces accessibles (scopés sur l'org courante).
  for (const [baseId, baseSpaceId] of databaseSpaceById) {
    if (!accessibleSpaceIdSet.has(baseSpaceId)) {
      resolved.delete(baseId);
    }
  }

  // Templates: filter out space-scoped templates not in an accessible space.
  // Global templates (isGlobal=true) and templates with no spaceId are kept.
  if (templateIds?.length) {
    const templateRows = await db
      .select({ id: templates.id, isGlobal: templates.isGlobal, spaceId: templates.spaceId })
      .from(templates)
      .where(inArray(templates.id, templateIds));

    for (const tmpl of templateRows) {
      if (!tmpl.isGlobal && tmpl.spaceId && !accessibleSpaceIdSet.has(tmpl.spaceId)) {
        resolved.delete(tmpl.id);
      }
    }
  }

  // Meetings: filter out meetings tied to a space in a foreign org.
  // Meetings with no spaceId (standalone) are kept.
  if (meetingIds?.length) {
    const meetingRows = await db
      .select({ id: meetings.id, spaceId: meetings.spaceId })
      .from(meetings)
      .where(inArray(meetings.id, meetingIds));

    for (const mtg of meetingRows) {
      if (mtg.spaceId && !accessibleSpaceIdSet.has(mtg.spaceId)) {
        resolved.delete(mtg.id);
      }
    }
  }

  // Calendar events: scopés via leur calendrier (checkCalendarAccess applique le
  // cloisonnement d'organisation). Un favori créé avant ce contrôle, ou dont
  // l'accès a été révoqué, ne doit plus exposer le titre ni la date.
  if (eventIds?.length) {
    const eventRows = await db
      .select({ id: calendarEvents.id, calendarId: calendarEvents.calendarId })
      .from(calendarEvents)
      .where(inArray(calendarEvents.id, eventIds));

    // Organisation de la requête résolue une seule fois pour toute la boucle.
    const orgId = await getRequestOrgId(user);
    const calendarAccess = new Map<string, boolean>();
    for (const evt of eventRows) {
      let allowed = calendarAccess.get(evt.calendarId);
      if (allowed === undefined) {
        allowed = await checkCalendarAccess(user.id, evt.calendarId, "read", orgId);
        calendarAccess.set(evt.calendarId, allowed);
      }
      if (!allowed) resolved.delete(evt.id);
    }
  }

  // 5. Build final ordered array
  const result: ResolvedFavorite[] = [];
  for (const fav of userFavorites) {
    const entry = resolved.get(fav.entityId);
    if (!entry) continue; // entity deleted or access revoked
    result.push({
      ...entry,
      title: entry.label, // le client lit `title`
      id: fav.id,
      position: fav.position,
    });
  }

  return NextResponse.json(result);
}

// ─── POST /api/favorites ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { entityType?: string; entityId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const { entityType, entityId } = body;

  if (
    !entityType ||
    !entityId ||
    !VALID_ENTITY_TYPES.includes(entityType as EntityType)
  ) {
    return NextResponse.json(
      { error: "entityType et entityId requis, entityType doit être un type valide" },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(entityId)) {
    return NextResponse.json({ error: "entityId invalide" }, { status: 400 });
  }

  // Contrôle d'accès sur l'entité fournie par le client avant tout stockage.
  const access = await checkEntityAccess(user, entityType as EntityType, entityId);
  if (access === "not-found") {
    return NextResponse.json({ error: "Entité introuvable" }, { status: 404 });
  }
  if (access === "forbidden") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Calculate next position
  const [maxRow] = await db
    .select({ maxPos: sql<number>`coalesce(max(${favorites.position}), -1)` })
    .from(favorites)
    .where(eq(favorites.userId, user.id));

  const nextPosition = (maxRow?.maxPos ?? -1) + 1;

  // Insert (idempotent — ignore conflict on unique index)
  const [created] = await db
    .insert(favorites)
    .values({
      userId: user.id,
      entityType: entityType as EntityType,
      entityId,
      position: nextPosition,
    })
    .onConflictDoNothing()
    .returning();

  if (!created) {
    // Already exists — return the existing one
    const [existing] = await db
      .select()
      .from(favorites)
      .where(
        and(
          eq(favorites.userId, user.id),
          eq(favorites.entityType, entityType as EntityType),
          eq(favorites.entityId, entityId)
        )
      )
      .limit(1);

    return NextResponse.json(existing, { status: 200 });
  }

  return NextResponse.json(created, { status: 201 });
}

// ─── DELETE /api/favorites?entityType=…&entityId=… ─────────────────────────────
// Variante par entité (utile pour toggler sans connaître l'id du favori).

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const entityType = request.nextUrl.searchParams.get("entityType");
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (
    !entityType ||
    !entityId ||
    !VALID_ENTITY_TYPES.includes(entityType as EntityType)
  ) {
    return NextResponse.json(
      { error: "entityType et entityId requis" },
      { status: 400 }
    );
  }

  await db
    .delete(favorites)
    .where(
      and(
        eq(favorites.userId, user.id),
        eq(favorites.entityType, entityType as EntityType),
        eq(favorites.entityId, entityId)
      )
    );

  return new NextResponse(null, { status: 204 });
}
