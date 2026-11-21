import { db } from "@/lib/db";
import { videoProjects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkSpaceReadAccess } from "@/lib/auth/check-access";
import { getMediaByStorageKey, resolveMediaAccess } from "@/lib/media/access";
import type { SessionUser } from "@/types";

/**
 * Contrôle d'accès aux objets du bucket servis par `/api/attachments/[...key]`
 * et `/api/attachments/signed`.
 *
 * La table `media` fait autorité pour la correspondance clé → périmètre, par
 * le résolveur d'accès unique `resolveMediaAccess`. Une liste blanche de
 * familles de clés sans ligne `media` complète le dispositif.
 *
 * Principe : refus par défaut. Toute famille de clés non listée est refusée.
 */

/** Familles lisibles par tout utilisateur authentifié de l'instance. */
const READABLE_PREFIXES = [
  "avatars/", // photo de profil d'un membre
  "branding/", // logo + favicon de l'instance
];

/**
 * Familles explicitement refusées ici : elles ont leurs propres routes, qui
 * portent leurs propres contrôles (organisation, projet, espace). Les laisser
 * passer par `/api/attachments` serait un contournement de ces contrôles.
 */
const DENIED_PREFIXES = [
  "studio/", // /api/studio/images/[id]
  "meeting-rooms/", // /api/meeting-rooms/[id]/...
  "designs/", // /api/designs/[id]
  "automations/", // /api/databases/.../runs/[runId]/document
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Détermine si `user` peut lire l'objet `key` du bucket.
 *
 * 1. Une ligne `media` portant cette `storageKey` fait autorité : le verdict
 *    est celui de `resolveMediaAccess` en lecture (organisation, corbeille,
 *    espace ou média hors espace).
 * 2. Repli historique : clé préfixée d'un UUID d'espace → contrôle d'espace.
 * 3. Médias du banc de montage (`video-editor/{projectId}/...`) → contrôle de
 *    l'espace du projet (imports Pexels et exports, sans ligne `media`).
 * 4. `avatars/` et `branding/` → lecture autorisée.
 * 5. Tout le reste → refus.
 */
export async function canReadStorageKey(
  user: SessionUser,
  key: string
): Promise<boolean> {
  if (!key || key.includes("..")) return false;

  const segments = key.split("/");
  // Un objet à la racine du bucket n'appartient à aucun périmètre connu.
  if (segments.length < 2) return false;

  if (DENIED_PREFIXES.some((p) => key.startsWith(p))) return false;

  const mediaRow = await getMediaByStorageKey(key);
  if (mediaRow) {
    return (await resolveMediaAccess(user, mediaRow, "read")).allowed;
  }

  if (READABLE_PREFIXES.some((p) => key.startsWith(p))) return true;

  const [first, second] = segments;

  if (first === "video-editor") {
    if (!UUID_RE.test(second)) return false;
    const [project] = await db
      .select({ spaceId: videoProjects.spaceId })
      .from(videoProjects)
      .where(eq(videoProjects.id, second))
      .limit(1);
    if (!project) return false;
    return checkSpaceReadAccess(user, project.spaceId);
  }

  if (UUID_RE.test(first)) {
    return checkSpaceReadAccess(user, first);
  }

  return false;
}
