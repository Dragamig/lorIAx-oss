import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { logActivity } from "@/lib/activity";
import { getMeetingInOrg, getMeetingParticipants, updateMeetingTitle, deleteMeeting, canAccessMeeting } from "@/lib/meet/rooms";
import { getSpacePermission } from "@/lib/auth/check-access";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  const orgId = await getRequestOrgId(user);
  // Fail-closed : org non résolue (non membre, slug inconnu) = réunion inexistante
  if (!orgId) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  const meeting = await getMeetingInOrg(id, orgId);

  if (!meeting) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  const allowed = await canAccessMeeting(user, meeting);
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const participants = await getMeetingParticipants(id);

  return NextResponse.json({ ...meeting, participants });
}

const patchSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  participants: z.array(z.string().max(100)).max(10).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  const orgId = await getRequestOrgId(user);
  // Fail-closed : org non résolue (non membre, slug inconnu) = réunion inexistante
  if (!orgId) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  const meeting = await getMeetingInOrg(id, orgId);

  if (!meeting) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  if (meeting.createdBy !== user.id) {
    void logActivity({ userId: user.id, action: "meeting.update_denied", entityType: "meeting", entityId: id, metadata: { } });
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  let updated = parsed.data.title
    ? await updateMeetingTitle(id, parsed.data.title)
    : meeting;

  if (parsed.data.participants !== undefined) {
    const returned = await db
      .update(meetings)
      .set({ participants: parsed.data.participants, updatedAt: new Date() })
      .where(eq(meetings.id, id))
      .returning();
    if (!returned[0]) {
      return NextResponse.json(
        { error: "Impossible de mettre à jour" },
        { status: 500 }
      );
    }
    updated = returned[0];
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  const orgId = await getRequestOrgId(user);
  // Fail-closed : org non résolue (non membre, slug inconnu) = réunion inexistante
  if (!orgId) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  const meeting = await getMeetingInOrg(id, orgId);

  if (!meeting) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  // Only scheduled meetings can be deleted
  if (meeting.status !== "scheduled") {
    return NextResponse.json(
      { error: "Seules les réunions planifiées peuvent être supprimées" },
      { status: 400 }
    );
  }

  // Droits : organisateur, administrateur de l'espace, ou administrateur
  // global. La réunion a déjà été confinée à l'organisation de la requête
  // ci-dessus : la dispense de rôle ne vaut donc que dans cette organisation,
  // dont l'utilisateur est membre (ou super_admin, seul rôle habilité à
  // franchir la frontière d'organisation).
  const isCreator = meeting.createdBy === user.id;
  const isOrgAdmin = hasGlobalRole(user.globalRole, "admin");
  let isSpaceAdmin = false;

  if (meeting.spaceId) {
    const perm = await getSpacePermission(user.id, meeting.spaceId);
    isSpaceAdmin = perm === "admin";
  }

  if (!isCreator && !isOrgAdmin && !isSpaceAdmin) {
    void logActivity({ userId: user.id, action: "meeting.delete_denied", entityType: "meeting", entityId: id, metadata: { } });
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  try {
    await deleteMeeting(id);
  } catch (err) {
    return NextResponse.json(
      { error: "Impossible de supprimer" },
      { status: 500 }
    );
  }
  void logActivity({ userId: user.id, action: "meeting.delete", entityType: "meeting", entityId: id, metadata: { } });
  return NextResponse.json({ success: true });
}
