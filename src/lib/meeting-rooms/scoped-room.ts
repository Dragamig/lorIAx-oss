import { db } from "@/lib/db";
import { meetingRooms } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getRequestOrgId } from "@/lib/org/get-request-org";

type SessionUserLike = { id: string; globalRole: string };

/**
 * Récupère une salle de réunion par id en la confinant à l'organisation de la
 * requête courante (sous-domaine → orgId).
 *
 * Retourne `null` si l'org n'est pas résolue (utilisateur non membre, slug
 * inconnu/inactif) ou si la salle relève d'une autre org (ou n'existe pas).
 * Fail-closed : une salle d'une autre organisation ne résout jamais —
 * l'appelant renvoie 404. Brique de cloisonnement de toutes les sous-routes
 * `/api/meeting-rooms/[id]/**`.
 */
export async function getMeetingRoomForRequest(
  roomId: string,
  user: SessionUserLike
): Promise<typeof meetingRooms.$inferSelect | null> {
  const orgId = await getRequestOrgId(user);
  if (!orgId) return null;

  const [room] = await db
    .select()
    .from(meetingRooms)
    .where(and(eq(meetingRooms.id, roomId), eq(meetingRooms.organizationId, orgId)))
    .limit(1);

  return room ?? null;
}
