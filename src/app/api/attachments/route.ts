import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { ingestMedia } from "@/lib/media/ingest";

/** Compatibilité : l'écriture passe par la médiathèque, `/api/media` est le successeur. */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const spaceId = formData.get("spaceId") as string | null;
  const documentId = formData.get("documentId") as string | null;

  if (!file || !spaceId) {
    return NextResponse.json({ error: "Fichier et spaceId requis" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  }

  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Validation, droit d'écriture sur l'espace (AZ-16), quota et stockage sont
  // portés par ingestMedia.
  const result = await ingestMedia({
    user,
    orgId,
    spaceId,
    documentId,
    file: { name: file.name, size: file.size, type: file.type },
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // URL durable same-origin plutôt qu'une URL S3 présignée qui expire : elle
  // est persistée telle quelle dans le document.
  return NextResponse.json(
    {
      ...result.media,
      url: `/api/attachments/${result.media.storageKey}`,
      mediaUrl: `/api/media/${result.media.id}`,
    },
    {
      status: 201,
      headers: {
        Deprecation: "true",
        Link: '</api/media>; rel="successor-version"',
      },
    }
  );
}
