import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { ingestMedia } from "@/lib/media/ingest";
import { FilterError, parseMediaFilters } from "@/lib/media/filters";
import { listMedia } from "@/lib/media/list";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  try {
    const filters = parseMediaFilters(request.nextUrl.searchParams);
    const result = await listMedia(user, orgId, filters);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof FilterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
  }
  const spaceId = (formData.get("spaceId") as string | null) || null;
  const documentId = (formData.get("documentId") as string | null) || null;

  const folderId = (formData.get("folderId") as string | null) || null;
  const tags = formData
    .getAll("tags")
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  const result = await ingestMedia({
    user,
    orgId,
    spaceId,
    documentId,
    folderId,
    tags,
    file: { name: file.name, size: file.size, type: file.type },
    validation: file.type.startsWith("video/") ? "video" : "default",
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { media, quota, hasLocationExif } = result;
  return NextResponse.json(
    {
      ...media,
      url: `/api/media/${media.id}`,
      thumbnailUrl: media.thumbnailKey ? `/api/media/${media.id}/thumbnail` : null,
      quota: { warn: quota.warn, percentAfter: quota.percentAfter },
      hasLocationExif,
      folderId: media.folderId ?? null,
      tags,
    },
    { status: 201 }
  );
}
