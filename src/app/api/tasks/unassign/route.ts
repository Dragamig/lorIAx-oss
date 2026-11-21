import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { documents, tasks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkDocumentEditAccess } from "@/lib/auth/check-access";

const schema = z.object({
  documentId: z.string().uuid(),
  nodeId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });

  const { documentId, nodeId } = parsed.data;

  // Route HTTP ordinaire : on utilise le helper SÛR (cloisonnement multi-tenant
  // inclus), pas la variante collab de @/lib/collab/auth-ws.
  const [doc] = await db
    .select({ spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

  const hasAccess = await checkDocumentEditAccess(user, doc.spaceId, documentId);
  if (!hasAccess) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  await db
    .update(tasks)
    .set({ assigneeId: null, updatedAt: new Date() })
    .where(and(eq(tasks.documentId, documentId), eq(tasks.nodeId, nodeId)));

  return NextResponse.json({ ok: true });
}
