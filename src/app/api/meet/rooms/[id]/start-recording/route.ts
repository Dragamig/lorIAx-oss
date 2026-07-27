import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMeeting, updateMeetingStatus, canAccessMeeting } from "@/lib/meet/rooms";
import { startRecording } from "@/lib/meet/egress";
import logger from "@/lib/logger";

const log = logger.child({ module: "meet-start-recording" });

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;
  const meeting = await getMeeting(id);

  if (!meeting) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  // H12 : Contrôle d'accès identique aux cinq routes voisines de /meet/rooms/[id]
  const allowed = await canAccessMeeting(user.id, meeting);
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Already recording
  if (meeting.egressId) {
    return NextResponse.json({ status: "already_recording", egressId: meeting.egressId });
  }

  // Must be active
  if (meeting.status !== "active") {
    return NextResponse.json({ error: "La réunion doit être active" }, { status: 400 });
  }

  try {
    const egressId = await startRecording(meeting.roomName);
    if (egressId) {
      await updateMeetingStatus(id, "active", { egressId });
      log.info({ meetingId: id, egressId }, "Recording started via manual trigger");
      return NextResponse.json({ status: "recording", egressId });
    }
    return NextResponse.json({ error: "Impossible de démarrer l'enregistrement" }, { status: 502 });
  } catch (error) {
    log.error({ error, meetingId: id }, "Failed to start recording");
    return NextResponse.json({ error: "Erreur Egress" }, { status: 500 });
  }
}
