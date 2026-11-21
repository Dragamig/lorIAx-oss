import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages, chatChannelMembers } from "@/lib/db/schema-chat";
import { documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkDocumentViewAccess, checkDocumentEditAccess } from "@/lib/auth/check-access";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  let documentId: string | undefined;
  try {
    const body = await req.json();
    documentId = body.documentId;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }
  if (!documentId) return NextResponse.json({ error: "documentId requis" }, { status: 400 });

  // Charger le message
  const [msg] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, id))
    .limit(1);

  if (!msg || msg.deletedAt) return NextResponse.json({ error: "Message introuvable" }, { status: 404 });

  // Vérifier appartenance au canal
  const [membership] = await db
    .select()
    .from(chatChannelMembers)
    .where(and(eq(chatChannelMembers.channelId, msg.channelId), eq(chatChannelMembers.userId, user.id)))
    .limit(1);

  if (!membership) return NextResponse.json({ error: "Accès au canal refusé" }, { status: 403 });

  // Vérifier droit d'écriture sur le document
  const [doc] = await db
    .select({ spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

  // Contrôle d'accès centralisé : la lecture couvre le cloisonnement
  // multi-tenant et la classification du document, l'édition couvre le droit
  // d'écriture nécessaire pour y verser un message.
  const canView = await checkDocumentViewAccess(user, doc.spaceId, documentId);
  if (!canView) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const canEdit = await checkDocumentEditAccess(user, doc.spaceId, documentId);
  if (!canEdit) {
    return NextResponse.json({ error: "Droit d'écriture requis sur le document" }, { status: 403 });
  }

  // Marquer le message comme versé dans ce document
  await db
    .update(chatMessages)
    .set({ documentRef: documentId })
    .where(eq(chatMessages.id, id));

  // Retourner le nœud TipTap formaté pour insertion côté client
  return NextResponse.json({
    tiptapNode: {
      type: "blockquote",
      attrs: {
        "data-chat-author": msg.authorId,
        "data-chat-date": msg.createdAt.toISOString(),
        "data-chat-message-id": msg.id,
      },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: msg.content ?? "" }],
        },
      ],
    },
  });
}
