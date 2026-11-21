import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { chatMessages } from "@/lib/db/schema-chat";
import { sql, eq } from "drizzle-orm";
import logger from "@/lib/logger";

export async function purgeExpiredMessages(): Promise<number> {
  try {
    // Fetch retention setting from system_settings
    const [setting] = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, "chat_retention_days"))
      .limit(1);

    const days = setting?.value ? Number(setting.value) : 365;
    if (!days || days <= 0) {
      logger.info({ days }, "[chat-retention] Rétention désactivée ou invalide");
      return 0;
    }

    const cutoff = new Date(Date.now() - days * 86_400_000);

    // Delete all messages older than cutoff (including soft-deleted ones)
    const result = await db
      .delete(chatMessages)
      .where(sql`${chatMessages.createdAt} < ${cutoff}`)
      .returning({ id: chatMessages.id });

    const count = result.length;
    logger.info({ days, cutoff, count }, "[chat-retention] Messages purgés");
    return count;
  } catch (err) {
    logger.error({ error: err }, "[chat-retention] Erreur lors de la purge");
    throw err;
  }
}

export async function getChatRetentionDays(): Promise<number> {
  try {
    const [setting] = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, "chat_retention_days"))
      .limit(1);

    return setting?.value ? Number(setting.value) : 365;
  } catch (err) {
    logger.error({ error: err }, "[chat-retention] Erreur lors de la lecture");
    return 365;
  }
}

export async function setChatRetentionDays(days: number): Promise<void> {
  try {
    await db
      .insert(systemSettings)
      .values({
        key: "chat_retention_days",
        value: days,
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: days, updatedAt: new Date() },
      });

    logger.info({ days }, "[chat-retention] Configuration mise à jour");
  } catch (err) {
    logger.error({ error: err, days }, "[chat-retention] Erreur lors de la mise à jour");
    throw err;
  }
}
