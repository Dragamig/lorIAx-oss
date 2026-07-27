import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSessionUser } from "@/lib/auth/get-user";
import { s3Client, BUCKET } from "@/lib/storage/s3";
import { resolveReadableAttachment } from "@/lib/storage/attachment-access";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { key: segments } = await params;
  const key = segments.join("/");

  // H8 - The key must belong to a registered attachment the caller may read.
  // An unknown key is reported as missing so the route cannot be used to probe
  // the content of the bucket.
  const access = await resolveReadableAttachment(user, key);
  if (!access.ok) {
    if (access.reason === "forbidden") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const response = await s3Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
    }

    const buffer = Buffer.from(await response.Body.transformToByteArray());
    const contentType = response.ContentType || "application/octet-stream";

    const filename = access.attachment.filename || segments[segments.length - 1] || "file";
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
    });
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
