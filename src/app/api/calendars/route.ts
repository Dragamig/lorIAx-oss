import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars, teams, spaces } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getAccessibleCalendarIds } from "@/lib/calendar/permissions";
import { z } from "zod";
import slugify from "slugify";
import crypto from "crypto";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json([], { status: 401 });

  // Cloisonnement multi-tenant : on s'appuie sur l'unique source de vérité
  // (getAccessibleCalendarIds), confinée à l'org du sous-domaine courant.
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json([], { status: 404 });

  const ids = await getAccessibleCalendarIds(user, orgId);
  if (ids.length === 0) return NextResponse.json([]);

  const rows = await db.select().from(calendars).where(inArray(calendars.id, ids));
  return NextResponse.json(rows.sort((a, b) => a.name.localeCompare(b.name)));
}

const createCalendarSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timezone: z.string().max(100).optional(),
  type: z.enum(["personal", "team", "organization"]).optional(),
  ownerTeamId: z.string().uuid().optional(),
  spaceId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await request.json();
  const parsed = createCalendarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { name, description, color, timezone, type, ownerTeamId, spaceId } = parsed.data;
  const calType = type || "personal";

  // Only admins can create organization calendars
  if (calType === "organization" && !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  // Team calendars require ownerTeamId
  if (calType === "team" && !ownerTeamId) {
    return NextResponse.json({ error: "ownerTeamId requis pour un calendrier d'équipe" }, { status: 400 });
  }

  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  // Cloisonnement multi-tenant : l'org du calendrier est dérivée de son rattachement.
  //   personal   → NULL (org-neutre, scopé par propriétaire)
  //   team        → org de l'équipe (doit appartenir à l'org courante)
  //   space       → org de l'espace (doit appartenir à l'org courante)
  //   organization→ org de la requête
  let organizationId: string | null = null;
  if (calType === "team" && ownerTeamId) {
    const [team] = await db
      .select({ organizationId: teams.organizationId })
      .from(teams)
      .where(eq(teams.id, ownerTeamId))
      .limit(1);
    if (!team || team.organizationId !== orgId) {
      return NextResponse.json({ error: "Équipe introuvable" }, { status: 404 });
    }
    organizationId = team.organizationId;
  } else if (calType === "organization") {
    organizationId = orgId;
  }

  if (spaceId) {
    const [space] = await db
      .select({ organizationId: spaces.organizationId })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);
    if (!space || space.organizationId !== orgId) {
      return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
    }
    organizationId = space.organizationId;
  }

  const baseSlug = slugify(name, { lower: true, strict: true });
  const caldavSlug = `${baseSlug}-${crypto.randomBytes(4).toString("hex")}`;

  const [calendar] = await db
    .insert(calendars)
    .values({
      name,
      description,
      color: color || "#3b82f6",
      timezone: timezone || "Europe/Paris",
      type: calType,
      ownerUserId: calType !== "team" ? user.id : undefined,
      ownerTeamId: calType === "team" ? ownerTeamId : undefined,
      spaceId,
      organizationId,
      caldavSlug,
      isDefault: false,
    })
    .returning();

  return NextResponse.json(calendar, { status: 201 });
}
