import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { guardMediaRead } from "@/lib/media/route-guard";
import { listVersionAuthors, listVersions, replaceMediaFile } from "@/lib/media/versions";
import {
  replaceFieldsSchema,
  replaceResultResponse,
  toVersionDto,
  UUID_RE,
} from "@/lib/media/versions-http";
import { maxUploadBytesFor, VIDEO_MAX_UPLOAD_BYTES } from "@/lib/media/upload-limits";

type Ctx = { params: Promise<{ id: string }> };

/** GET : historique des versions (la plus récente d'abord). Lecture du média requise. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const g = await guardMediaRead(id);
  if (!g.ok) return g.res;
  const versions = await listVersions(id, g.row.organizationId);
  const authors = await listVersionAuthors(g.row.organizationId, versions);
  return NextResponse.json(
    {
      currentVersion: g.row.currentVersion,
      versions: versions.map((v) => toVersionDto(v, (v.createdBy && authors.get(v.createdBy)) || null)),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** POST : remplace le fichier (multipart `file`, `expectedVersion`, `comment?`). */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Média introuvable" }, { status: 404 });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > VIDEO_MAX_UPLOAD_BYTES + 1024 * 1024) {
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
  const parsed = replaceFieldsSchema.safeParse({
    expectedVersion: form.get("expectedVersion"),
    comment: typeof form.get("comment") === "string" ? form.get("comment") : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }
  if (file.size > maxUploadBytesFor({ type: file.type })) {
    return NextResponse.json({ error: "Fichier trop volumineux" }, { status: 413 });
  }

  const result = await replaceMediaFile({
    user,
    orgId,
    mediaId: id,
    expectedVersion: parsed.data.expectedVersion,
    comment: parsed.data.comment,
    file: { name: file.name, size: file.size, type: file.type },
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  return replaceResultResponse(result);
}
