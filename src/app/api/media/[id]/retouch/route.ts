import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { saveRetouch } from "@/lib/media/retouch";
import { toMediaDto, UUID_RE } from "@/lib/media/versions-http";
import { MAX_UPLOAD_BYTES } from "@/lib/media/upload-limits";

type Ctx = { params: Promise<{ id: string }> };

const fieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    mode: z.enum(["derived", "version"]).default("derived"),
    spaceId: z.string().uuid().nullable(),
    folderId: z.string().uuid().nullable(),
    expectedVersion: z.coerce.number().int().min(1).optional(),
    comment: z.string().max(2000).optional(),
  })
  .strict();

const opt = (v: FormDataEntryValue | null) => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * POST : enregistre le fichier rendu par le retoucheur, en média dérivé
 * (défaut) ou en nouvelle version de l'original (`mode=version`).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Média introuvable" }, { status: 404 });

  const limit = await checkRateLimitAsync(`media-retouch:${user.id}`, RATE_LIMITS.mediaRetouch);
  if (!limit.success) {
    const retry = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429, headers: { "Retry-After": String(retry) } });
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: "Fichier trop volumineux" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Corps multipart invalide" }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux" }, { status: 413 });
  }
  const parsed = fieldsSchema.safeParse({
    name: opt(form.get("name")),
    mode: opt(form.get("mode")),
    spaceId: opt(form.get("spaceId")) ?? null,
    folderId: opt(form.get("folderId")) ?? null,
    expectedVersion: opt(form.get("expectedVersion")),
    comment: opt(form.get("comment")),
  });
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  const f = parsed.data;

  const result = await saveRetouch({
    user,
    orgId,
    sourceId: id,
    mode: f.mode,
    spaceId: f.spaceId,
    folderId: f.folderId,
    name: f.name,
    expectedVersion: f.expectedVersion,
    comment: f.comment,
    file: { name: file.name, size: file.size, type: file.type },
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.quota ? { quota: result.quota } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json(
    {
      media: toMediaDto(result.media),
      duplicate: result.duplicate,
      quota: result.quota,
      ...(result.versionId ? { versionId: result.versionId } : {}),
    },
    { status: result.duplicate || f.mode === "version" ? 200 : 201, headers: { "Cache-Control": "private, no-store" } },
  );
}
