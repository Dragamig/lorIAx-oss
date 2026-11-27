import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { restoreVersion } from "@/lib/media/versions";
import {
  parseVersionParam,
  replaceResultResponse,
  restoreBodySchema,
  UUID_RE,
} from "@/lib/media/versions-http";

type Ctx = { params: Promise<{ id: string; version: string }> };

/** POST : restaure une ancienne version comme nouvelle version courante. */
export async function POST(request: Request, { params }: Ctx) {
  const { id, version } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const n = parseVersionParam(version);
  if (!UUID_RE.test(id) || n === null) {
    return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  }

  const body = restoreBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });

  const result = await restoreVersion({
    user,
    orgId,
    mediaId: id,
    version: n,
    expectedVersion: body.data.expectedVersion,
  });
  return replaceResultResponse(result);
}
