import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api/auth-api";
import { apiError } from "@/lib/api/response";
import { apiUserToSessionUser, requireMediaScope } from "@/lib/api/media-user";
import { getMediaTagLabels, loadReadableMedia, toV1Media } from "@/lib/api/v1-media";
import { listVersions, replaceMediaFile } from "@/lib/media/versions";
import { replaceFieldsSchema, toVersionDto, UUID_RE } from "@/lib/media/versions-http";
import { maxUploadBytesFor, VIDEO_MAX_UPLOAD_BYTES } from "@/lib/media/upload-limits";
import { establishedTypeOf } from "@/lib/media/validate-upload";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = VIDEO_MAX_UPLOAD_BYTES + 1024 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store" };

/** Version publique : ni clé de stockage ni auteur. */
function toV1Version(v: Parameters<typeof toVersionDto>[0]) {
  const { createdBy: _c, createdByName: _n, ...rest } = toVersionDto(v);
  void _c;
  void _n;
  return rest;
}

/** GET /api/v1/media/<id>/versions : historique. Portée `media:read`. */
export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;
  const scopeErr = requireMediaScope(auth.user, "media:read");
  if (scopeErr) return scopeErr;

  const { id } = await params;
  const user = await apiUserToSessionUser(auth.user);
  const found = await loadReadableMedia(user, auth.user.orgId, id);
  if (!found.ok) return found.res;

  const versions = await listVersions(found.row.id, auth.user.orgId);
  return NextResponse.json(
    { success: true, data: { currentVersion: found.row.currentVersion, versions: versions.map(toV1Version) } },
    { headers: NO_STORE },
  );
}

/** POST /api/v1/media/<id>/versions : remplace le fichier (multipart). Portée `media:write`. */
export async function POST(request: Request, { params }: Ctx) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;
  const scopeErr = requireMediaScope(auth.user, "media:write");
  if (scopeErr) return scopeErr;

  const { id } = await params;
  if (!UUID_RE.test(id)) return apiError("Média introuvable", 404);

  const limit = await checkRateLimitAsync(
    `api-media-upload:${auth.user.keyId ?? auth.user.id}`,
    RATE_LIMITS.mediaUploadApi,
  );
  if (!limit.success) return apiError("Limite de requêtes dépassée", 429);

  const declared = Number(request.headers.get("content-length"));
  if (!request.headers.get("content-length") || !Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
    return apiError("Fichier trop volumineux (max 200 Mo)", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Corps multipart invalide", 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return apiError("Fichier requis", 400);
  const comment = form.get("comment");
  const parsed = replaceFieldsSchema.safeParse({
    expectedVersion: form.get("expectedVersion"),
    comment: typeof comment === "string" ? comment : undefined,
  });
  if (!parsed.success) return apiError("Paramètres invalides (expectedVersion entier requis)", 400);

  const type = establishedTypeOf(file);
  if (file.size > maxUploadBytesFor({ type })) {
    return apiError(
      type.startsWith("video/") ? "Fichier trop volumineux (max 200 Mo)" : "Fichier trop volumineux (max 50 Mo)",
      413,
    );
  }

  const user = await apiUserToSessionUser(auth.user);
  const r = await replaceMediaFile({
    user,
    orgId: auth.user.orgId,
    mediaId: id,
    expectedVersion: parsed.data.expectedVersion,
    comment: parsed.data.comment,
    file: { name: file.name, size: file.size, type },
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  if (!r.ok) return apiError(r.error, r.status);
  const tags = await getMediaTagLabels(r.media.id);
  return NextResponse.json(
    {
      success: true,
      data: {
        media: { ...toV1Media(r.media, tags), currentVersion: r.media.currentVersion },
        version: toV1Version(r.version),
        quota: { warn: r.quota.warn, percentAfter: r.quota.percentAfter },
        usages: r.usages,
      },
    },
    { status: 201, headers: NO_STORE },
  );
}
