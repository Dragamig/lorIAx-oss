import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api/auth-api";
import { apiError } from "@/lib/api/response";
import { apiUserToSessionUser, requireMediaScope } from "@/lib/api/media-user";
import { loadReadableMedia } from "@/lib/api/v1-media";
import { getMediaTextState } from "@/lib/media/ai/text-state";
import { parseTextQuery } from "@/lib/media/ai/text-http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/media/<id>/text : état d'indexation et texte extrait (page bornée). Portée `media:read`. */
export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;
  const scopeErr = requireMediaScope(auth.user, "media:read");
  if (scopeErr) return scopeErr;

  const { id } = await params;
  const user = await apiUserToSessionUser(auth.user);
  const found = await loadReadableMedia(user, auth.user.orgId, id);
  if (!found.ok) return found.res;
  const q = parseTextQuery(request.url);
  if (!q.success) return apiError("Paramètres invalides", 400);

  const state = await getMediaTextState(found.row, q.data);
  return NextResponse.json(
    { success: true, data: state },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
