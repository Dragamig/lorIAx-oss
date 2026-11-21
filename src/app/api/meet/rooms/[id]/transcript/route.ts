import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getMeetingInOrg, getMeetingTranscriptPath, canAccessMeeting } from "@/lib/meet/rooms";
import { getLiveKitConfig } from "@/lib/meet/livekit-config";
import logger from "@/lib/logger";

const log = logger.child({ module: "meet-transcript" });

/** Au dela de cette taille, le transcript est tronque avant envoi au client. */
const MAX_TRANSCRIPT_CHARS = 500_000;

/**
 * Verifie que le chemin stocke en base pointe bien a l'interieur du repertoire
 * d'enregistrements attendu. Protege contre toute traversee de chemin si la
 * valeur en base venait a etre alteree.
 */
async function resolveSafeTranscriptPath(storedPath: string): Promise<string | null> {
  const config = await getLiveKitConfig();
  const root = resolve(/*turbopackIgnore: true*/ config.livekitEgressPath || "/recordings");
  const candidate = resolve(/*turbopackIgnore: true*/ root, storedPath);
  const rel = relative(root, candidate);

  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return candidate;
}

export async function GET(
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

  const allowed = await canAccessMeeting(user, meeting);
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Sonde legere utilisee par l'interface pour n'afficher le bouton que si un
  // transcript existe reellement (pas de lecture du contenu).
  const metaOnly = req.nextUrl.searchParams.get("meta") === "1";

  const storedPath = await getMeetingTranscriptPath(id);
  if (!storedPath) {
    if (metaOnly) return NextResponse.json({ available: false });
    return NextResponse.json(
      { error: "Aucune transcription n'a été enregistrée pour cette réunion." },
      { status: 404 }
    );
  }

  const filePath = await resolveSafeTranscriptPath(storedPath);
  if (!filePath) {
    log.warn({ meetingId: id, storedPath }, "Transcript path outside recordings directory, refused");
    if (metaOnly) return NextResponse.json({ available: false });
    return NextResponse.json(
      { error: "Transcription indisponible." },
      { status: 404 }
    );
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    if (metaOnly) return NextResponse.json({ available: false });
    return NextResponse.json(
      { error: "Le fichier de transcription n'est plus disponible sur le serveur." },
      { status: 404 }
    );
  }

  if (metaOnly) {
    return NextResponse.json({ available: true, sizeBytes: fileStat.size });
  }

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    log.error({ error, meetingId: id }, "Failed to read transcript file");
    return NextResponse.json(
      { error: "Impossible de lire la transcription." },
      { status: 500 }
    );
  }

  const truncated = raw.length > MAX_TRANSCRIPT_CHARS;
  const content = truncated ? raw.slice(0, MAX_TRANSCRIPT_CHARS) : raw;

  return NextResponse.json({ content, truncated });
}
