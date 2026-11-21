import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatChannels, chatChannelMembers } from "@/lib/db/schema-chat";
import { eq, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const rows = await db
    .select({
      id: chatChannels.id,
      type: chatChannels.type,
      name: chatChannels.name,
      teamId: chatChannels.teamId,
      spaceId: chatChannels.spaceId,
      lastReadAt: chatChannelMembers.lastReadAt,
      unreadCount: sql<number>`
        (SELECT COUNT(*) FROM chat_messages m
         WHERE m.channel_id = ${chatChannels.id}
           AND m.created_at > COALESCE(${chatChannelMembers.lastReadAt}, '-infinity'::timestamptz)
           AND m.deleted_at IS NULL)::int
      `,
    })
    .from(chatChannelMembers)
    .innerJoin(chatChannels, eq(chatChannelMembers.channelId, chatChannels.id))
    .where(eq(chatChannelMembers.userId, user.id))
    .orderBy(chatChannels.type, chatChannels.name);

  return NextResponse.json(rows);
}
