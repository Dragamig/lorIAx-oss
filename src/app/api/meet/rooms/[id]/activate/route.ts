import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { logActivity } from "@/lib/activity";
import { getMeetingInOrg, updateMeetingStatus } from "@/lib/meet/rooms";

export async function POST(
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

  if (meeting.createdBy !== user.id) {
    void logActivity({ userId: user.id, action: "meeting.activate_denied", entityType: "meeting", entityId: id, metadata: { } });
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  if (meeting.status !== "scheduled") {
    return NextResponse.json({ error: "Réunion ne peut pas être activée dans cet état", status: meeting.status }, { status: 400 });
  }

  const updated = await updateMeetingStatus(id, "active", {
    startedAt: new Date(),
  });

  void logActivity({ userId: user.id, action: "meeting.activate", entityType: "meeting", entityId: id, metadata: { } });
  return NextResponse.json({ status: updated.status });
}
