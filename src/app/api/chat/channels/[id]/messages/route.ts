import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages, chatChannelMembers } from "@/lib/db/schema-chat";
import { users } from "@/lib/db/schema";
import { eq, and, lt, isNull, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const [membership] = await db
    .select()
    .from(chatChannelMembers)
    .where(and(eq(chatChannelMembers.channelId, id), eq(chatChannelMembers.userId, user.id)))
    .limit(1);

  if (!membership) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const before = req.nextUrl.searchParams.get("before");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 100);

  if (before) {
    const d = new Date(before);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Paramètre before invalide" }, { status: 400 });
    }
  }

  const conditions = [
    eq(chatMessages.channelId, id),
    isNull(chatMessages.deletedAt),
    ...(before ? [lt(chatMessages.createdAt, new Date(before))] : []),
  ];

  const rows = await db
    .select({
      id: chatMessages.id,
      channelId: chatMessages.channelId,
      content: chatMessages.content,
      editedAt: chatMessages.editedAt,
      documentRef: chatMessages.documentRef,
      createdAt: chatMessages.createdAt,
      author: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(chatMessages)
    .leftJoin(users, eq(chatMessages.authorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return NextResponse.json(rows.reverse());
}
