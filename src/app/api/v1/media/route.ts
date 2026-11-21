import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api/auth-api";
import { apiError } from "@/lib/api/response";
import { apiUserToSessionUser, requireMediaScope } from "@/lib/api/media-user";
import { getMediaTagLabels, listItemsToV1, toV1Media } from "@/lib/api/v1-media";
import { checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { ingestMedia } from "@/lib/media/ingest";
import { maxUploadBytesFor, VIDEO_MAX_UPLOAD_BYTES } from "@/lib/media/upload-limits";
import { establishedTypeOf } from "@/lib/media/validate-upload";
import { MEDIA_TAGS_MAX, TAG_LABEL_MAX, tagSlug } from "@/lib/media/tags";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { FilterError, parseMediaFilters } from "@/lib/media/filters";
import { listMedia } from "@/lib/media/list";

/** Paramètres de liste acceptés en v1 ; la vue (corbeille, hors espace...) n'est jamais exposée. */
const ALLOWED_PARAMS = ["q", "kind", "spaceId", "folderId", "limit", "cursor", "sort", "dir"] as const;

/**
 * GET /api/v1/media : liste filtrable, pagination par curseur. Portée `media:read`.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireMediaScope(auth.user, "media:read");
  if (scopeErr) return scopeErr;

  const incoming = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const name of ALLOWED_PARAMS) {
    for (const v of incoming.getAll(name)) params.append(name, v);
  }
  // `tag` désigne l'identifiant d'un tag ; plusieurs valeurs se cumulent.
  for (const v of incoming.getAll("tag")) params.append("tagId", v);

  try {
    const filters = parseMediaFilters(params);
    const user = await apiUserToSessionUser(auth.user);
    const { items, nextCursor } = await listMedia(user, auth.user.orgId, filters);
    const data = await listItemsToV1(items);
    return NextResponse.json(
      {
        success: true,
        data,
        nextCursor,
        meta: { cursor: nextCursor, hasMore: nextCursor !== null },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    if (err instanceof FilterError) return apiError(err.message, 400);
    throw err;
  }
}

/** Corps multipart maximal accepté avant lecture : 200 Mo plus 1 Mo de marge d'encodage. */
const MAX_BODY_BYTES = VIDEO_MAX_UPLOAD_BYTES + 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/media : téléversement multipart (`file`, `spaceId` obligatoire,
 * `folderId?`, `tags*`). Portée `media:write`. Passe par la voie unique
 * `ingestMedia` (validation par contenu, quota, journal). Origine `upload` :
 * l'enum d'origine n'a pas de valeur `api`.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireMediaScope(auth.user, "media:write");
  if (scopeErr) return scopeErr;

  const limit = await checkRateLimitAsync(
    `api-media-upload:${auth.user.keyId ?? auth.user.id}`,
    RATE_LIMITS.mediaUploadApi
  );
  if (!limit.success) return apiError("Limite de requêtes dépassée", 429);

  // Refus avant toute lecture : formData() charge le corps entier en mémoire.
  const declaredLength = Number(request.headers.get("content-length"));
  if (!request.headers.get("content-length") || !Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
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

  const spaceId = form.get("spaceId");
  if (typeof spaceId !== "string" || !UUID_RE.test(spaceId)) {
    return apiError("spaceId requis (UUID)", 400);
  }
  const folderRaw = form.get("folderId");
  const folderId = typeof folderRaw === "string" && folderRaw ? folderRaw : null;
  const tags = form
    .getAll("tags")
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  // Les tags sont validés ici : ingestMedia n'échoue pas sur une erreur de tag.
  const tagLabels = tags.map((t) => t.trim());
  if (
    tagLabels.length > MEDIA_TAGS_MAX ||
    tagLabels.some((l) => l.length > TAG_LABEL_MAX || !tagSlug(l))
  ) {
    return apiError(
      `Tags invalides (${MEDIA_TAGS_MAX} au plus, ${TAG_LABEL_MAX} caractères au plus, libellé non vide)`,
      400
    );
  }

  const user = await apiUserToSessionUser(auth.user);
  // Espace d'une autre organisation, inconnu ou non modifiable : 404 silencieux.
  if (!(await checkSpaceWriteAccess(user, spaceId, { orgId: auth.user.orgId }))) {
    return apiError("Espace introuvable", 404);
  }

  // Type établi : pour une extension texte, celui de l'extension, pas celui du client.
  const type = establishedTypeOf(file);
  if (file.size > maxUploadBytesFor({ type })) {
    return apiError(
      type.startsWith("video/") ? "Fichier trop volumineux (max 200 Mo)" : "Fichier trop volumineux (max 50 Mo)",
      413
    );
  }

  const result = await ingestMedia({
    user,
    orgId: auth.user.orgId,
    spaceId,
    folderId,
    tags,
    origin: "upload",
    validation: type.startsWith("video/") ? "video" : "default",
    file: { name: file.name, size: file.size, type },
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) return apiError(result.error, result.status);

  const labels = await getMediaTagLabels(result.media.id);
  return NextResponse.json(
    { success: true, data: toV1Media(result.media, labels) },
    { status: 201, headers: { "Cache-Control": "private, no-store" } }
  );
}
