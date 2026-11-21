import { authenticateApiRequest } from "@/lib/api/auth-api";
import { apiUserToSessionUser, requireMediaScope } from "@/lib/api/media-user";
import { loadReadableMedia } from "@/lib/api/v1-media";
import { serveMediaObject } from "@/lib/media/serve";

/**
 * GET /api/v1/media/<id>/content : octets du média (Range, ETag). Portée `media:read`.
 * Mêmes en-têtes que `/api/media/<id>` : type, nosniff, SVG et HTML servis en pièce jointe.
 * Cette route n'est jamais encadrable (X-Frame-Options DENY par défaut, voir frame-policy.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireMediaScope(auth.user, "media:read");
  if (scopeErr) return scopeErr;

  const { id } = await params;
  const user = await apiUserToSessionUser(auth.user);
  const found = await loadReadableMedia(user, auth.user.orgId, id);
  if (!found.ok) return found.res;

  const { row } = found;
  return serveMediaObject({
    req: request,
    key: row.storageKey,
    mime: row.mimeType,
    filename: row.filename,
    etagSeed: `${row.id}-${row.updatedAt.getTime()}`,
    inline: true,
    maxAgeSeconds: 0,
    revalidate: true,
  });
}
