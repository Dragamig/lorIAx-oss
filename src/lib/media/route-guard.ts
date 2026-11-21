import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMediaFull, resolveMediaAccess } from "@/lib/media/access";
import type { Media } from "@/lib/db/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contrôle commun : 401 sans session, 404 inconnu ou autre organisation, 403 sinon. */
export async function guardMediaRead(
  id: string
): Promise<{ ok: true; row: Media } | { ok: false; res: NextResponse }> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  }
  const notFound = {
    ok: false as const,
    res: NextResponse.json({ error: "Média introuvable" }, { status: 404 }),
  };
  if (!UUID_RE.test(id)) return notFound;
  const row = await getMediaFull(id);
  if (!row) return notFound;
  const verdict = await resolveMediaAccess(user, row, "read");
  if (!verdict.allowed) {
    if (verdict.reason === "org") return notFound;
    return { ok: false, res: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
  }
  return { ok: true, row };
}
