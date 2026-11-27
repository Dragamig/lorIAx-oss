import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api/auth-api";
import { apiUserToSessionUser, requireMediaScope } from "@/lib/api/media-user";
import { countMediaVersions, getMediaTagLabels, loadReadableMedia, toV1Media } from "@/lib/api/v1-media";

/** GET /api/v1/media/<id> : métadonnées d'un média. Portée `media:read`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireMediaScope(auth.user, "media:read");
  if (scopeErr) return scopeErr;

  const { id } = await params;
  const user = await apiUserToSessionUser(auth.user);
  const found = await loadReadableMedia(user, auth.user.orgId, id);
  if (!found.ok) return found.res;

  const [tags, versionCount] = await Promise.all([
    getMediaTagLabels(found.row.id),
    countMediaVersions(found.row.id),
  ]);
  return NextResponse.json(
    { success: true, data: { ...toV1Media(found.row, tags), currentVersion: found.row.currentVersion, versionCount } },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
