import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { getSessionUser } from "@/lib/auth/get-user";
import { s3Client, BUCKET, uploadFile } from "@/lib/storage/s3";
import { db } from "@/lib/db";
import { designSnapshots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  checkCanvasViewAccess,
  checkCanvasEditAccess,
  getRequestedDocumentId,
} from "@/lib/auth/canvas-access";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 Mo

function validateId(id: string): boolean {
  return UUID_REGEX.test(id);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;

  if (!validateId(id)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  // La table design_snapshots ne porte que le rattachement au document : c'est
  // elle qui autorise (ou non) la lecture de l'objet S3. Sans ligne, on ne lit
  // pas S3 du tout et on renvoie un canevas vide, ce qui couvre à la fois la
  // création d'un nouveau design et le fail-closed sur un design non rattaché.
  const [row] = await db
    .select({ documentId: designSnapshots.documentId })
    .from(designSnapshots)
    .where(eq(designSnapshots.designId, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({}, { status: 200 });
  }

  const access = await checkCanvasViewAccess(user, row.documentId);
  if (!access.ok) {
    return NextResponse.json({ error: "Accès refusé" }, { status: access.status });
  }

  const key = `designs/${id}.json`;

  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const json = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    return NextResponse.json(json, { status: 200 });
  } catch (err: unknown) {
    const code = (err as { name?: string; Code?: string }).name ?? (err as { Code?: string }).Code;
    if (code === "NoSuchKey" || code === "NotFound") {
      return NextResponse.json({}, { status: 200 });
    }
    console.error("[designs/GET] Erreur S3 :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await params;

  if (!validateId(id)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Payload trop volumineux (max 5 Mo)" },
      { status: 413 }
    );
  }

  const [row] = await db
    .select({ documentId: designSnapshots.documentId })
    .from(designSnapshots)
    .where(eq(designSnapshots.designId, id))
    .limit(1);

  const access = await checkCanvasEditAccess(user, id, {
    rowExists: !!row,
    storedDocumentId: row?.documentId ?? null,
    requestedDocumentId: getRequestedDocumentId(request),
  });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 400 ? "Document porteur manquant" : "Accès refusé" },
      { status: access.status }
    );
  }

  const key = `designs/${id}.json`;

  try {
    // Le lien est écrit avant l'envoi S3 : jamais de charge utile orpheline.
    await db
      .insert(designSnapshots)
      .values({ designId: id, documentId: access.documentId })
      .onConflictDoUpdate({
        target: designSnapshots.designId,
        set: { documentId: access.documentId, updatedAt: new Date() },
      });

    await uploadFile(key, Buffer.from(serialized), "application/json");
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[designs/PUT] Erreur S3 :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
