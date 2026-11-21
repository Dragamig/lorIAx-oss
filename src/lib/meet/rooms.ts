import { db } from "@/lib/db";
import { meetings, meetingParticipants, documents, spaces, calendarEvents, calendarEventAttendees } from "@/lib/db/schema";
import { eq, desc, and, or, inArray } from "drizzle-orm";
import { getSpacePermission } from "@/lib/auth/check-access";
import { hasGlobalRole } from "@/lib/auth/rbac";
import type { UserRole } from "@/types";
import crypto from "crypto";

/**
 * Generate an auto-title for a meeting based on its context.
 * Format: YYYY-MM-DD_space-slug_document-slug
 *
 * N'effectue AUCUN contrôle d'accès : le slug du document est repris tel quel
 * dans le titre. L'appelant DOIT avoir vérifié l'accès en lecture au document
 * (`checkDocumentViewAccess`) avant de passer `documentId`.
 */
export async function generateAutoTitle(
  spaceId: string,
  documentId?: string
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);

  const [space] = await db
    .select({ name: spaces.name, slug: spaces.slug })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) return `${date}_reunion`;

  const spaceSlug = space.slug;

  if (!documentId) return `${date}_${spaceSlug}`;

  const [doc] = await db
    .select({ title: documents.title, slug: documents.slug })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return `${date}_${spaceSlug}`;

  return `${date}_${spaceSlug}_${doc.slug}`;
}

/**
 * Generate a URL-safe room name from a title.
 */
function generateRoomName(title: string): string {
  const date = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 chars
  return `${date}_${slug}_${suffix}`;
}

interface CreateMeetingInput {
  title: string;
  spaceId: string;
  documentId?: string;
  createdBy: string;
  mode: "immediate" | "scheduled";
  meetingType?: "video" | "in_person";
  scheduledAt?: string; // ISO 8601
  calendarId?: string;
  attendeeUserIds?: string[];
}

/**
 * Crée une réunion, et, en mode planifié, l'événement de calendrier associé.
 *
 * N'effectue AUCUN contrôle d'accès : `documentId`, `calendarId` et
 * `attendeeUserIds` sont repris tels quels et écrits en base. L'appelant DOIT
 * avoir vérifié, dans l'organisation de la requête :
 * - la lecture du document (`checkDocumentViewAccess`) ;
 * - l'écriture dans le calendrier (`checkCalendarAccess(..., "write", orgId)`),
 *   faute de quoi un événement atterrit dans le calendrier privé d'un tiers ;
 * - l'appartenance des invités à l'organisation (`getOrgMemberIds`), faute de
 *   quoi des utilisateurs d'un autre tenant sont convoqués.
 *
 * Ces trois contrôles sont posés par `POST /api/meet/rooms`, seul appelant.
 */
export async function createMeeting(input: CreateMeetingInput) {
  const roomName = generateRoomName(input.title);
  const now = new Date();

  const isImmediate = input.mode === "immediate";

  // Validate scheduledAt date before database insert
  if (!isImmediate && input.scheduledAt) {
    const d = new Date(input.scheduledAt);
    if (isNaN(d.getTime())) throw new Error('Invalid ISO 8601 date');
  }

  const [meeting] = await db
    .insert(meetings)
    .values({
      title: input.title,
      roomName,
      spaceId: input.spaceId,
      documentId: input.documentId || null,
      createdBy: input.createdBy,
      meetingType: input.meetingType ?? "video",
      status: isImmediate ? "active" : "scheduled",
      startedAt: isImmediate ? now : null,
      scheduledAt: isImmediate ? null : input.scheduledAt ? new Date(input.scheduledAt) : null,
    })
    .returning();

  // If scheduled and a calendarId is provided, create linked calendar event
  if (!isImmediate && input.calendarId && input.scheduledAt) {
    const startAt = new Date(input.scheduledAt);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000); // 1h default
    const uid = `${crypto.randomUUID()}@loriax`;

    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: input.calendarId,
        title: input.title,
        startAt,
        endAt,
        uid,
        meetingId: meeting.id,
        createdBy: input.createdBy,
      })
      .returning();

    // Link meeting to event
    await db
      .update(meetings)
      .set({ calendarEventId: event.id, updatedAt: now })
      .where(eq(meetings.id, meeting.id));

    // Add organizer as attendee
    await db.insert(calendarEventAttendees).values({
      eventId: event.id,
      userId: input.createdBy,
      role: "organizer",
      status: "accepted",
    });

    // Add invited participants
    if (input.attendeeUserIds?.length) {
      await db.insert(calendarEventAttendees).values(
        input.attendeeUserIds.map((userId) => ({
          eventId: event.id,
          userId,
          role: "required" as const,
          status: "needs-action" as const,
        }))
      );
    }

    return { ...meeting, calendarEventId: event.id };
  }

  return meeting;
}

/**
 * Charge une réunion par identifiant SANS aucun filtre d'organisation.
 *
 * RÉSERVÉ aux contextes qui n'ont pas de requête HTTP porteuse de session :
 * pipeline de fin de réunion, tâches de fond, relectures internes déclenchées
 * après un contrôle d'accès déjà effectué. Le nom est explicite pour qu'un
 * appel depuis une route authentifiée saute aux yeux en revue.
 *
 * → Toute route authentifiée doit utiliser {@link getMeetingInOrg}.
 */
export async function getMeetingUnscoped(id: string) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id));
  return meeting || null;
}

/**
 * Charge une réunion par identifiant en la confinant à une organisation.
 *
 * L'organisation est un paramètre explicite et obligatoire : elle est résolue
 * par l'appelant (`getRequestOrgId`), jamais devinée ici. Une réunion d'un
 * autre tenant ne résout pas, l'appelant répond alors 404 muet.
 *
 * La jointure interne sur `spaces` est volontaire : une réunion dont l'espace
 * a été supprimé (`spaceId` nul) n'est rattachable à aucune organisation, elle
 * est donc invisible depuis un chemin authentifié (fail-closed).
 */
export async function getMeetingInOrg(id: string, orgId: string) {
  const [row] = await db
    .select({ meeting: meetings })
    .from(meetings)
    .innerJoin(spaces, eq(spaces.id, meetings.spaceId))
    .where(and(eq(meetings.id, id), eq(spaces.organizationId, orgId)))
    .limit(1);
  return row?.meeting ?? null;
}

/**
 * Charge une réunion par nom de salle SANS filtre d'organisation.
 * Mêmes règles d'emploi que {@link getMeetingUnscoped}.
 */
export async function getMeetingByRoomNameUnscoped(roomName: string) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.roomName, roomName));
  return meeting || null;
}

/**
 * Charge une réunion par nom de salle en la confinant à une organisation.
 * Variante de {@link getMeetingInOrg} pour l'émission des jetons LiveKit, où
 * le client ne connaît que le nom de la salle.
 */
export async function getMeetingByRoomNameInOrg(roomName: string, orgId: string) {
  const [row] = await db
    .select({ meeting: meetings })
    .from(meetings)
    .innerJoin(spaces, eq(spaces.id, meetings.spaceId))
    .where(and(eq(meetings.roomName, roomName), eq(spaces.organizationId, orgId)))
    .limit(1);
  return row?.meeting ?? null;
}

/**
 * Liste les réunions visibles par un utilisateur, confinées à une organisation.
 *
 * L'organisation est un paramètre explicite et obligatoire, résolu par
 * l'appelant (`getRequestOrgId`), jamais devinée ici : sans elle, un
 * utilisateur membre de plusieurs organisations voyait ses réunions toutes
 * organisations confondues, y compris sur un sous-domaine où elles n'ont rien
 * à faire (fuite de métadonnées : titre, espace, horaires).
 *
 * La jointure interne sur `spaces` est volontaire et strictement alignée sur
 * {@link getMeetingInOrg} : la table `meetings` ne porte pas d'organisation,
 * celle-ci est dérivée de l'espace, et `meetings.space_id` est nullable
 * (`onDelete: set null`). Une réunion dont l'espace a été supprimé n'est
 * rattachable à aucune organisation, elle est donc invisible depuis un chemin
 * authentifié (fail-closed), exactement comme au chargement par identifiant.
 */
export async function listMeetings(userId: string, orgId: string, limit = 20) {
  // Include meetings the user created OR participated in
  const participatedMeetingIds = db
    .select({ meetingId: meetingParticipants.meetingId })
    .from(meetingParticipants)
    .where(eq(meetingParticipants.userId, userId));

  const result = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      roomName: meetings.roomName,
      spaceId: meetings.spaceId,
      documentId: meetings.documentId,
      notesDocumentId: meetings.notesDocumentId,
      status: meetings.status,
      recordingPath: meetings.recordingPath,
      transcriptPath: meetings.transcriptPath,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
      scheduledAt: meetings.scheduledAt,
      createdBy: meetings.createdBy,
      createdAt: meetings.createdAt,
      updatedAt: meetings.updatedAt,
      spaceSlug: spaces.slug,
    })
    .from(meetings)
    .innerJoin(spaces, eq(meetings.spaceId, spaces.id))
    .where(
      and(
        eq(spaces.organizationId, orgId),
        or(
          eq(meetings.createdBy, userId),
          inArray(meetings.id, participatedMeetingIds)
        )
      )
    )
    .orderBy(desc(meetings.createdAt))
    .limit(limit);
  return result;
}

export async function updateMeetingTitle(id: string, title: string) {
  const [updated] = await db
    .update(meetings)
    .set({ title, updatedAt: new Date() })
    .where(eq(meetings.id, id))
    .returning();
  return updated;
}

export async function updateMeetingStatus(
  id: string,
  status: typeof meetings.$inferInsert.status,
  extra?: Partial<typeof meetings.$inferInsert>
) {
  const [updated] = await db
    .update(meetings)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(meetings.id, id))
    .returning();

  // Sync calendar event status
  if (updated?.calendarEventId) {
    let eventStatus: "confirmed" | "cancelled" | undefined;
    if (status === "active") eventStatus = "confirmed";
    if (status === "failed") eventStatus = "cancelled";

    if (eventStatus) {
      await db
        .update(calendarEvents)
        .set({ status: eventStatus, updatedAt: new Date() })
        .where(eq(calendarEvents.id, updated.calendarEventId));
    }
  }

  return updated;
}

export async function addParticipant(
  meetingId: string,
  userId: string | null,
  displayName: string
) {
  const [participant] = await db
    .insert(meetingParticipants)
    .values({
      meetingId,
      userId,
      displayName,
      joinedAt: new Date(),
    })
    .returning();
  return participant;
}

export async function getMeetingParticipants(meetingId: string) {
  return db
    .select()
    .from(meetingParticipants)
    .where(eq(meetingParticipants.meetingId, meetingId));
}

export async function deleteMeeting(id: string) {
  // Get meeting to check for linked calendar event
  const [meeting] = await db
    .select({ calendarEventId: meetings.calendarEventId })
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);

  // Cancel linked calendar event if exists
  if (meeting?.calendarEventId) {
    await db
      .update(calendarEvents)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(calendarEvents.id, meeting.calendarEventId));
  }

  // meetingParticipants has onDelete: "cascade", no manual cleanup needed
  const [deleted] = await db
    .delete(meetings)
    .where(eq(meetings.id, id))
    .returning();
  return deleted || null;
}

/**
 * Détermine si un utilisateur peut accéder à une réunion.
 * Autorisés : l'organisateur, un participant, un administrateur de l'espace,
 * ou un administrateur global.
 *
 * PRÉCONDITION : `meeting` a déjà été confinée à l'organisation de la requête
 * (chargée via {@link getMeetingInOrg} ou {@link getMeetingByRoomNameInOrg}).
 * L'organisation d'abord, la dispense de rôle ensuite : la dispense accordée
 * ici aux rôles `admin` et `super_admin` ne vaut donc QUE dans l'organisation
 * courante, dont l'utilisateur est nécessairement membre (ou `super_admin`,
 * seul rôle habilité à franchir la frontière d'organisation).
 *
 * Le rôle global est passé par l'appelant depuis la session, il n'est plus
 * relu en base : une relecture masquait le fait qu'aucune organisation
 * n'entrait dans la décision.
 */
export async function canAccessMeeting(
  user: { id: string; globalRole: string },
  meeting: { id: string; createdBy: string | null; spaceId: string | null }
): Promise<boolean> {
  // Organisateur
  if (meeting.createdBy === user.id) return true;

  // Participant
  const [participant] = await db
    .select({ id: meetingParticipants.id })
    .from(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.userId, user.id)
      )
    )
    .limit(1);
  if (participant) return true;

  // Dispense de rôle, bornée à l'organisation courante
  if (hasGlobalRole(user.globalRole as UserRole, "admin")) return true;

  // Administrateur de l'espace
  if (meeting.spaceId) {
    const perm = await getSpacePermission(user.id, meeting.spaceId);
    if (perm === "admin") return true;
  }

  return false;
}

/**
 * Chemin du fichier de transcript brut d'une réunion, ou null si aucun
 * transcript n'a été produit (réunions anciennes, transcription désactivée,
 * pipeline en échec).
 * Le chemin renvoyé provient de la base : l'appelant doit valider qu'il reste
 * bien dans le répertoire d'enregistrements avant toute lecture disque.
 */
export async function getMeetingTranscriptPath(
  meetingId: string
): Promise<string | null> {
  const [meeting] = await db
    .select({ transcriptPath: meetings.transcriptPath })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);

  return meeting?.transcriptPath ?? null;
}

export async function getMeetingWithNotes(meetingId: string) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);

  if (!meeting || !meeting.notesDocumentId) return null;

  const [doc] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.contentText,
      spaceId: documents.spaceId,
    })
    .from(documents)
    .where(eq(documents.id, meeting.notesDocumentId))
    .limit(1);

  if (!doc || !doc.spaceId) return null;

  const [space] = await db
    .select({ slug: spaces.slug })
    .from(spaces)
    .where(eq(spaces.id, doc.spaceId))
    .limit(1);

  if (!space) return null;

  return {
    documentId: doc.id,
    title: doc.title,
    content: doc.content ?? "",
    spaceSlug: space.slug,
  };
}
