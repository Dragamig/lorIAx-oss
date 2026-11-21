import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { generateLiveKitToken } from "@/lib/meet/livekit-token";
import { getLiveKitConfig } from "@/lib/meet/livekit-config";
import { getMeetingByRoomNameInOrg, canAccessMeeting } from "@/lib/meet/rooms";
import { z } from "zod";

const tokenSchema = z.object({
  roomName: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const lkConfig = await getLiveKitConfig();
  if (!lkConfig.livekitApiKey || !lkConfig.livekitApiSecret) {
    return NextResponse.json(
      { error: "LiveKit non configuré (clés API manquantes)" },
      { status: 503 }
    );
  }

  const body = await req.json();
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  // Cloisonnement d'abord : la salle doit relever de l'organisation courante.
  // Sans ce filtre, un jeton LiveKit roomJoin+canPublish pouvait être émis sur
  // la salle d'un autre tenant. Un dépareillement reste un 404 muet.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  const meeting = await getMeetingByRoomNameInOrg(parsed.data.roomName, orgId);
  if (!meeting) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 });
  }

  const allowed = await canAccessMeeting(user, meeting);
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const token = await generateLiveKitToken({
    roomName: parsed.data.roomName,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  });

  return NextResponse.json({ token });
}
