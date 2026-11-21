import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { checkRateLimitAsync, getClientIpOrNull, RATE_LIMITS } from "@/lib/rate-limit";
import { createMeeting, generateAutoTitle, listMeetings } from "@/lib/meet/rooms";
import { checkVisioPermission } from "@/lib/meet/permissions";
import { z } from "zod";
import { recordOnboardingEvent } from "@/lib/onboarding/progress";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getOrgMemberIds } from "@/lib/org/org-members";

const createRoomSchema = z.object({
  title: z.string().max(255).optional(),
  spaceId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  mode: z.enum(["immediate", "scheduled"]).default("immediate"),
  type: z.enum(["video", "in_person"]).default("video"),
  scheduledAt: z.string().datetime().optional(),
  calendarId: z.string().uuid().optional(),
  attendeeUserIds: z.array(z.string().uuid()).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // Cf. AZ-25 : `null` vaut absence d'adresse, pas adresse partagée ; la route
  // est authentifiée, on retombe sur l'identité du compte.
  const ip = getClientIpOrNull(req);
  const bucket = ip ? `ip:${ip}` : `user:${user.id}`;
  const rl = await checkRateLimitAsync(`meet:${bucket}`, RATE_LIMITS.meet);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Trop de requêtes, réessayez plus tard" },
      { status: 429 }
    );
  }

  const body = await req.json();
  const parsed = createRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { mode, spaceId, documentId } = parsed.data;
  const meetingType = parsed.data.type;

  // Cloisonnement : l'espace visé doit relever de l'organisation de la requête
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
  }

  // Check visio permission
  const action = mode === "immediate" ? "create_immediate" : "create_scheduled";
  const allowed = await checkVisioPermission(user.id, spaceId, action, orgId);
  if (!allowed) {
    return NextResponse.json(
      { error: "Permission insuffisante pour créer une réunion dans cet espace" },
      { status: 403 }
    );
  }

  // Le documentId vient du corps de la requête : sans contrôle, le titre et le
  // slug d'un document arbitraire (potentiellement d'une autre organisation)
  // fuiteraient dans le titre de la réunion, et la réunion resterait liée à ce
  // document. On refuse explicitement plutôt que d'ignorer silencieusement le
  // paramètre : le lien document ↔ réunion est persisté, une création qui
  // l'écarterait sans le dire produirait une réunion incohérente.
  if (documentId) {
    const [doc] = await db
      .select({ spaceId: documents.spaceId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!doc) {
      return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    }
    const canView = await checkDocumentViewAccess(user, doc.spaceId, documentId);
    if (!canView) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  // Le `calendarId` vient lui aussi du corps de la requête, et `createMeeting`
  // insère un événement dans ce calendrier. Sans contrôle, un compte légitime
  // agissant dans son propre espace posait un événement dans le calendrier
  // privé d'un tiers, y compris d'une autre organisation. Le droit requis pour
  // écrire dans un calendrier est `write`, et l'organisation de la requête est
  // passée explicitement : `checkCalendarAccess` refuse une organisation
  // absente (fail-closed).
  const { calendarId, attendeeUserIds } = parsed.data;

  if (calendarId) {
    const canWriteCalendar = await checkCalendarAccess(
      user.id,
      calendarId,
      "write",
      orgId
    );
    if (!canWriteCalendar) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  // Les invités deviennent des lignes `calendar_event_attendees` : convoquer un
  // utilisateur d'un autre tenant lui exposerait la réunion dans son agenda.
  // On intersecte donc avec les membres de l'organisation courante, comme la
  // création de conversation directe. L'appartenance remplace l'existence : un
  // identifiant inconnu et celui d'un membre d'un autre tenant donnent la même
  // réponse, ce qui ferme l'oracle d'existence de comptes. Refus explicite
  // plutôt que filtrage silencieux : la liste d'invités est persistée, une
  // création qui en écarterait une partie sans le dire serait incohérente.
  if (attendeeUserIds?.length) {
    const memberIds = await getOrgMemberIds(orgId);
    const etrangers = attendeeUserIds.filter((id) => !memberIds.includes(id));
    if (etrangers.length > 0) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 404 }
      );
    }
  }

  // Generate auto-title if not provided
  const title = parsed.data.title?.trim() || await generateAutoTitle(spaceId, documentId);

  const meeting = await createMeeting({
    title,
    spaceId,
    documentId,
    createdBy: user.id,
    mode,
    meetingType,
    scheduledAt: parsed.data.scheduledAt,
    calendarId,
    attendeeUserIds,
  });

  // Instrumentation onboarding : visio créée (1re fois suffit)
  recordOnboardingEvent(user.id, "visio").catch(() => {});

  return NextResponse.json(meeting, { status: 201 });
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // Cloisonnement : la liste est bornée à l'organisation du sous-domaine.
  // `null` (organisation introuvable, inactive, ou dont l'utilisateur n'est pas
  // membre) vaut « aucun accès », jamais « toutes les organisations ».
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json([]);

  const limit = Number(req.nextUrl.searchParams.get("limit")) || 20;
  const result = await listMeetings(user.id, orgId, Math.min(limit, 50));
  return NextResponse.json(result);
}
