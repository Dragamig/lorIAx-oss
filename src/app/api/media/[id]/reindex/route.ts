import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMediaFull, resolveMediaAccess } from "@/lib/media/access";
import { requestReindex } from "@/lib/media/ai/reindex";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-store" };

/** POST : remet le média en file d'indexation. Droit d'écriture requis. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const notFound = () => NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  if (!UUID_RE.test(id)) return notFound();
  const row = await getMediaFull(id);
  if (!row || row.deletedAt) return notFound();
  const read = await resolveMediaAccess(user, row, "read");
  if (!read.allowed) return notFound();
  const write = await resolveMediaAccess(user, row, "write");
  if (!write.allowed) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const limit = await checkRateLimitAsync(`media-reindex:${user.id}`, RATE_LIMITS.mediaReindex);
  if (!limit.success) {
    const retry = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429, headers: { "Retry-After": String(retry) } });
  }

  const r = await requestReindex(row);
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status, headers: NO_STORE });
  return NextResponse.json({ status: r.status }, { headers: NO_STORE });
}
