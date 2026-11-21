import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mindmapSnapshots } from "@/lib/db/schema";
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
  { params }: { params: Promise<{ mindmapId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { mindmapId } = await params;

  const [row] = await db
    .select()
    .from(mindmapSnapshots)
    .where(eq(mindmapSnapshots.mindmapId, mindmapId))
    .limit(1);

  // Aucune carte enregistrée : rien à divulguer.
  if (!row) {
    return NextResponse.json({ data: null, thumbnailUrl: null });
  }

  const access = await checkCanvasViewAccess(user, row.documentId);
  if (!access.ok) {
    return NextResponse.json({ error: "Accès refusé" }, { status: access.status });
  }

  return NextResponse.json({ data: row.data, thumbnailUrl: row.thumbnailUrl ?? null });
}

const postSchema = z.object({
  data: z.string().min(1),
  thumbnailUrl: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mindmapId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { mindmapId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [row] = await db
    .select({ documentId: mindmapSnapshots.documentId })
    .from(mindmapSnapshots)
    .where(eq(mindmapSnapshots.mindmapId, mindmapId))
    .limit(1);

  const access = await checkCanvasEditAccess(user, mindmapId, {
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

  const { data, thumbnailUrl } = parsed.data;

  await db
    .insert(mindmapSnapshots)
    .values({
      mindmapId,
      data,
      thumbnailUrl: thumbnailUrl ?? null,
      documentId: access.documentId,
    })
    .onConflictDoUpdate({
      target: mindmapSnapshots.mindmapId,
      set: {
        data,
        thumbnailUrl: thumbnailUrl ?? null,
        documentId: access.documentId,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true });
}
