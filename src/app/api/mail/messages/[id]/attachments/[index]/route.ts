import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { isUserUploadKey } from "@/lib/mailing/attachments";
import { getVisibleMail } from "@/lib/mailing/threads";
import { getMediaFull } from "@/lib/media/access";
import { getFileUrl } from "@/lib/storage/s3";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const access = await requireCrm({ level: "member", requireEnabled: false }, req);
  if (!access.ok) return access.response;
  const { id, index } = await params;
  if (!z.string().uuid().safeParse(id).success || !/^\d{1,3}$/.test(index)) return notFound();

  const row = await getVisibleMail(access.orgId, access.user.id, id);
  const ref = row?.attachments?.[Number(index)];
  if (!row || !ref) return notFound();

  // La clé de stockage vient de la base (média) ou doit vivre sous le préfixe du propriétaire (téléversement).
  let key: string;
  if (ref.source === "media") {
    const media = ref.mediaId ? await getMediaFull(ref.mediaId) : null;
    if (!media || media.organizationId !== access.orgId) return notFound();
    key = media.storageKey;
  } else {
    if (!isUserUploadKey(ref.storageKey, access.orgId, row.userId)) return notFound();
    key = ref.storageKey;
  }
  const safeName = ref.fileName.replace(/["\\\r\n]/g, "_");
  const url = await getFileUrl(key, 300, {
    contentDisposition: `attachment; filename="${safeName}"`,
    contentType: "application/octet-stream",
  });
  return NextResponse.redirect(url, 302);
}
