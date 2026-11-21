import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getMeetingInOrg, canAccessMeeting } from "@/lib/meet/rooms";

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

  let speakers = undefined;
  if (meeting.status === "mapping" && meeting.speakerMapping) {
    const data = meeting.speakerMapping;
    if (data && "_pending" in data && data._pending && data.speakerFirstWords) {
      speakers = Object.entries(data.speakerFirstWords).map(([id, firstWords]) => ({
        id,
        firstWords,
      }));
    }
  }

  return NextResponse.json({
    id: meeting.id,
    status: meeting.status,
    notesDocumentId: meeting.notesDocumentId,
    egressId: meeting.egressId || null,
    speakers,
  });
}
