import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages, chatChannelMembers, chatChannels } from "@/lib/db/schema-chat";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const [msg] = await db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1);

  if (!msg || msg.deletedAt) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  if (msg.authorId !== user.id) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const [patchMembership] = await db
    .select({ channelId: chatChannelMembers.channelId })
    .from(chatChannelMembers)
    .where(and(eq(chatChannelMembers.channelId, msg.channelId), eq(chatChannelMembers.userId, user.id)))
    .limit(1);
  if (!patchMembership) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) {
    return NextResponse.json({ error: "Délai d'édition dépassé (15 min)" }, { status: 403 });
  }

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }
  const { content } = body;
  if (!content?.trim()) return NextResponse.json({ error: "Contenu vide" }, { status: 400 });

  const [updated] = await db
    .update(chatMessages)
    .set({ content: content.trim(), editedAt: new Date() })
    .where(eq(chatMessages.id, id))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const [msg] = await db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1);

  if (!msg || msg.deletedAt) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Cloisonnement multi-tenant (audit AZ-06) : le message est chargé par
  // identifiant nu, sans organisation. Le canal porte la sienne, on la
  // confronte à l'organisation de la requête AVANT toute décision de rôle.
  // Sans ce filtre, la dispense `isAdmin` ci-dessous supprimait le message
  // d'un canal d'un autre tenant. 404 (jamais 403) pour ne pas révéler
  // l'existence du message.
  const [channel] = await db
    .select({ organizationId: chatChannels.organizationId })
    .from(chatChannels)
    .where(eq(chatChannels.id, msg.channelId))
    .limit(1);
  const requestOrgId = await getRequestOrgId(user);
  if (!channel || !requestOrgId || channel.organizationId !== requestOrgId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const isAdmin = hasGlobalRole(user.globalRole, "admin");
  if (msg.authorId !== user.id && !isAdmin) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  if (!isAdmin) {
    const [deleteMembership] = await db
      .select({ channelId: chatChannelMembers.channelId })
      .from(chatChannelMembers)
      .where(and(eq(chatChannelMembers.channelId, msg.channelId), eq(chatChannelMembers.userId, user.id)))
      .limit(1);
    if (!deleteMembership) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, id));

  return NextResponse.json({ success: true });
}
