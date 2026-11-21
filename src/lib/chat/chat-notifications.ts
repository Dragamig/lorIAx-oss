import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { chatChannelMembers } from "@/lib/db/schema-chat";
import { eq, and, ne, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { chatDigestEmailHtml } from "@/lib/email/templates/chat-digest";
import logger from "@/lib/logger";

export async function notifyChannelMembers(opts: {
  channelId: string;
  authorId: string;
  messageId: string;
  content: string;
  connectedUserIds: Set<string>;
}): Promise<void> {
  const members = await db
    .select({ userId: chatChannelMembers.userId })
    .from(chatChannelMembers)
    .where(
      and(
        eq(chatChannelMembers.channelId, opts.channelId),
        ne(chatChannelMembers.userId, opts.authorId)
      )
    );

  const offline = members.filter((m) => !opts.connectedUserIds.has(m.userId));
  if (offline.length === 0) return;

  await db.insert(notifications).values(
    offline.map((m) => ({
      userId: m.userId,
      type: "chat_message" as const,
      title: "Nouveau message",
      message: opts.content.slice(0, 200),
      actorId: opts.authorId,
    }))
  );
}

export async function sendChatDigests(): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const usersWithUnread = await db.execute(sql`
    SELECT
      u.id,
      u.email,
      u.name
    FROM users u
    JOIN chat_channel_members m ON m.user_id = u.id
    JOIN chat_messages msg ON msg.channel_id = m.channel_id
      AND msg.created_at > COALESCE(m.last_read_at, '-infinity'::timestamptz)
      AND msg.deleted_at IS NULL
    GROUP BY u.id, u.email, u.name
    HAVING COUNT(msg.id) > 0
  `);

  for (const userRow of usersWithUnread.rows as { id: string; email: string; name: string }[]) {
    try {
      const channelRows = await db.execute(sql`
        SELECT
          COALESCE(c.name, 'Message direct') AS name,
          COUNT(msg.id)::int AS unread_count,
          (SELECT content FROM chat_messages WHERE channel_id = c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT u2.name FROM users u2 JOIN chat_messages msg2 ON msg2.author_id = u2.id WHERE msg2.channel_id = c.id AND msg2.deleted_at IS NULL ORDER BY msg2.created_at DESC LIMIT 1) AS last_author
        FROM chat_channel_members m
        JOIN chat_channels c ON c.id = m.channel_id
        JOIN chat_messages msg ON msg.channel_id = c.id
          AND msg.created_at > COALESCE(m.last_read_at, '-infinity'::timestamptz)
          AND msg.deleted_at IS NULL
        WHERE m.user_id = ${userRow.id}
        GROUP BY c.id, c.name
      `);

      const channels = (
        channelRows.rows as {
          name: string;
          unread_count: number;
          last_message: string;
          last_author: string;
        }[]
      ).map((r) => ({
        name: r.name,
        unreadCount: r.unread_count,
        lastMessage: (r.last_message ?? "").slice(0, 200),
        lastAuthor: r.last_author ?? "Inconnu",
      }));

      await sendEmail({
        to: userRow.email,
        subject: `${channels.reduce((s, c) => s + c.unreadCount, 0)} messages non lus sur LorIAx`,
        html: chatDigestEmailHtml({ recipientName: userRow.name, channels, appUrl }),
      });

      logger.info({ userId: userRow.id }, "[chat-digest] Email envoyé");
    } catch (err) {
      logger.error({ err, userId: userRow.id }, "[chat-digest] Erreur envoi");
    }
  }
}
