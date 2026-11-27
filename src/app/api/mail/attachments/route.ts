import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { consumeQuota, peekQuotaExceeded } from "@/lib/rate-limit";
import { validateUpload } from "@/lib/media/validate-upload";
import { uploadFile } from "@/lib/storage/s3";
import { MAX_MAIL_ATTACHMENTS_BYTES, uploadPrefix } from "@/lib/mailing/attachments";
import type { MailAttachmentRef } from "@/lib/db/schema-mailing";

/** 60 téléversements par heure et par utilisateur. */
const UPLOAD_TIER = [{ maxRequests: 60, windowMs: 3_600_000 }];

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireOrgScoped({}, req);
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  // Pré-vérification sans consommer, puis consommation : refus avant toute lecture du corps.
  const limitKey = `mail-upload:${ctx.user.id}`;
  if (await peekQuotaExceeded(limitKey, UPLOAD_TIER)) {
    return NextResponse.json(
      { error: "Trop de téléversements, réessayez plus tard", code: "upload_rate_limited" },
      { status: 429 },
    );
  }
  await consumeQuota(limitKey, UPLOAD_TIER);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Fichier requis", code: "file_required" }, { status: 400 });
  }
  if (file.size > MAX_MAIL_ATTACHMENTS_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 20 Mo)", code: "too_large" }, { status: 413 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const v = await validateUpload({ name: file.name, size: buffer.length, type: file.type }, buffer);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const storageKey = `${uploadPrefix(ctx.orgId, ctx.user.id)}${randomUUID()}-${v.safeName}`;
  await uploadFile(storageKey, buffer, v.mime);
  const ref: MailAttachmentRef = {
    source: "upload",
    storageKey,
    fileName: v.safeName,
    mimeType: v.mime,
    size: buffer.length,
  };
  return NextResponse.json(ref, { status: 201 });
}
