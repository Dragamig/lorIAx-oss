import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { whiteboardSnapshots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  checkCanvasViewAccess,
  checkCanvasEditAccess,
  getRequestedDocumentId,
} from "@/lib/auth/canvas-access";
import { z } from "zod";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { canvasId } = await params;

  const [row] = await db
    .select()
    .from(whiteboardSnapshots)
    .where(eq(whiteboardSnapshots.canvasId, canvasId))
    .limit(1);

  // Aucun canevas enregistré : rien à divulguer, on renvoie le vide.
  if (!row) {
    return NextResponse.json({ elements: [] });
  }

  const access = await checkCanvasViewAccess(user, row.documentId);
  if (!access.ok) {
    return NextResponse.json({ error: "Accès refusé" }, { status: access.status });
  }

  try {
    const snapshot = JSON.parse(row.snapshot);
    return NextResponse.json(snapshot);
  } catch {
    return NextResponse.json({ elements: [] });
  }
}

const postSchema = z.object({
  elements: z.array(z.any()),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { canvasId } = await params;

  const body = await request.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [row] = await db
    .select({ documentId: whiteboardSnapshots.documentId })
    .from(whiteboardSnapshots)
    .where(eq(whiteboardSnapshots.canvasId, canvasId))
    .limit(1);

  const access = await checkCanvasEditAccess(user, canvasId, {
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

  const { elements } = parsed.data;
  const snapshot = JSON.stringify({ elements });

  await db
    .insert(whiteboardSnapshots)
    .values({ canvasId, snapshot, documentId: access.documentId })
    .onConflictDoUpdate({
      target: whiteboardSnapshots.canvasId,
      set: {
        snapshot,
        documentId: access.documentId,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true });
}
