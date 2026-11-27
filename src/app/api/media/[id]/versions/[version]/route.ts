import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { deleteVersion } from "@/lib/media/versions";
import { toMediaDto, UUID_RE } from "@/lib/media/versions-http";

type Ctx = { params: Promise<{ id: string; version: string }> };

/** DELETE : supprime une version désignée par son id de ligne (la courante cède la place à la précédente). */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id, version } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  if (!UUID_RE.test(id) || !UUID_RE.test(version)) {
    return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  }

  const requireCurrent = new URL(req.url).searchParams.get("requireCurrent") === "1";
  const r = await deleteVersion({ user, orgId, mediaId: id, versionId: version, requireCurrent });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(
    { media: toMediaDto(r.media) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
