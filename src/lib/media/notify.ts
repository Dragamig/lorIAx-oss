import { and, isNotNull, gt, lte, lt, like, inArray, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { db } from "@/lib/db";
import { media, systemSettings, users, organizationMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createNotification } from "@/lib/notifications";
import { getTrashRetentionPolicy } from "@/lib/media/library-settings";
import { getOrgStorageUsedBytes } from "@/lib/media/quota";
import { getHooks } from "@/lib/modules/hooks";
import logger from "@/lib/logger";

const DAY_MS = 86_400_000;
/** Préavis avant la purge définitive. */
export const NOTICE_DAYS = 7;
const SENTINEL_PREFIX = "media.trashNotified.";
const SENTINEL_TTL_DAYS = 120;
const FALLBACK_LOCALE = "fr";

/**
 * Sentinelle d'un média en corbeille. La date de mise à la corbeille et le délai
 * de rétention font partie de la clé : un média restauré puis remis à la
 * corbeille, ou un délai modifié, donne lieu à une nouvelle notification.
 */
export function trashSentinelKey(mediaId: string, deletedAt: Date, retentionDays: number): string {
  return `${SENTINEL_PREFIX}${mediaId}.${deletedAt.getTime()}.${retentionDays}`;
}

async function loadMessages(locale: string): Promise<Record<string, unknown>> {
  try {
    return (await import(`../../../messages/${locale}.json`)).default;
  } catch {
    return (await import(`../../../messages/${FALLBACK_LOCALE}.json`)).default;
  }
}

/**
 * Prévient, J-7 avant la purge, l'auteur de la mise à la corbeille : un seul
 * message groupé par auteur. Idempotent d'un jour à l'autre (et entre instances)
 * grâce à une sentinelle insérée avec ON CONFLICT DO NOTHING.
 */
export async function notifyTrashNearPurge(now: Date = new Date()): Promise<{ notified: number }> {
  const policy = await getTrashRetentionPolicy(now);
  const { trashRetentionDays } = policy;
  const notifyFrom = new Date(now.getTime() - Math.max(trashRetentionDays - NOTICE_DAYS, 0) * DAY_MS);
  const purgeBefore = new Date(now.getTime() - policy.effectiveDays * DAY_MS);
  /** Date de purge réelle : pendant le préavis d'une réduction, pas avant sa fin. */
  const purgeAt = (deletedAt: Date): number => {
    const nominal = deletedAt.getTime() + trashRetentionDays * DAY_MS;
    if (!policy.previousDays || !policy.noticeEndsAt) return nominal;
    return Math.min(
      deletedAt.getTime() + policy.previousDays * DAY_MS,
      Math.max(nominal, policy.noticeEndsAt.getTime())
    );
  };

  const rows = (await db
    .select({ id: media.id, deletedBy: media.deletedBy, deletedAt: media.deletedAt })
    .from(media)
    .where(
      and(
        isNotNull(media.deletedAt),
        isNotNull(media.deletedBy),
        lte(media.deletedAt, notifyFrom),
        gt(media.deletedAt, purgeBefore)
      )
    )) as { id: string; deletedBy: string | null; deletedAt: Date | null }[];

  const candidates = rows.filter(
    (r): r is { id: string; deletedBy: string; deletedAt: Date } => !!r.deletedBy && !!r.deletedAt
  );
  if (candidates.length > 0) {
    const byKey = new Map(candidates.map((r) => [trashSentinelKey(r.id, r.deletedAt, trashRetentionDays), r]));
    const claimed = await db
      .insert(systemSettings)
      .values([...byKey.keys()].map((key) => ({ key, value: { at: now.toISOString() } })))
      .onConflictDoNothing()
      .returning({ key: systemSettings.key });

    const perAuthor = new Map<string, { count: number; daysLeft: number; keys: string[] }>();
    for (const { key } of claimed) {
      const r = byKey.get(key);
      if (!r) continue;
      const left = Math.max(1, Math.ceil((purgeAt(r.deletedAt) - now.getTime()) / DAY_MS));
      const cur = perAuthor.get(r.deletedBy);
      perAuthor.set(r.deletedBy, {
        count: (cur?.count ?? 0) + 1,
        daysLeft: Math.min(cur?.daysLeft ?? left, left),
        keys: [...(cur?.keys ?? []), key],
      });
    }

    let notified = 0;
    for (const [userId, { count, daysLeft, keys }] of perAuthor) {
      try {
        const [u] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
        const locale = u?.locale ?? FALLBACK_LOCALE;
        const t = createTranslator({
          locale,
          messages: await loadMessages(locale),
          namespace: "library.notify.trashNearPurge",
        } as never) as unknown as (k: string, v: Record<string, number>) => string;
        await createNotification({
          userId,
          type: "media",
          title: t("title", { count, days: daysLeft }),
          message: t("message", { count, days: daysLeft }),
        });
        notified += 1;
      } catch (err) {
        logger.error({ err, userId }, "Notification de purge prochaine en échec");
        // Sentinelles levées : le prochain passage retentera l'envoi.
        try {
          await db.delete(systemSettings).where(inArray(systemSettings.key, keys));
        } catch (cleanupErr) {
          logger.warn({ err: cleanupErr, userId }, "Retrait des sentinelles de purge en échec");
        }
      }
    }
    await cleanupSentinels(now);
    return { notified };
  }
  await cleanupSentinels(now);
  return { notified: 0 };
}

/** Retire les sentinelles périmées (média purgé ou restauré depuis longtemps). */
async function cleanupSentinels(now: Date): Promise<void> {
  try {
    await db
      .delete(systemSettings)
      .where(
        and(
          like(systemSettings.key, `${SENTINEL_PREFIX}%`),
          lt(systemSettings.updatedAt, new Date(now.getTime() - SENTINEL_TTL_DAYS * DAY_MS))
        )
      );
  } catch (err) {
    logger.warn({ err }, "Nettoyage des sentinelles de purge en échec");
  }
}

const QUOTA_SENTINEL_PREFIX = "media.notified.";
/** Sous ce pourcentage, la sentinelle est effacée et un nouveau franchissement notifie. */
const QUOTA_RESET_PERCENT = 75;
const QUOTA_WARN_PERCENT = 80;
const QUOTA_FULL_PERCENT = 100;

/**
 * Prévient les admins de l'organisation au franchissement de 80 % puis de 100 %
 * du quota de stockage. Un palier n'est notifié qu'une fois : une sentinelle
 * `media.notified.<orgId>` porte le dernier palier annoncé, effacée sous 75 %.
 * Ne lève jamais : un upload n'échoue pas à cause d'une notification.
 */
export async function notifyQuotaThreshold(
  orgId: string,
  _percentBefore: number,
  percentAfter: number
): Promise<void> {
  const key = `${QUOTA_SENTINEL_PREFIX}${orgId}`;
  try {
    if (percentAfter < QUOTA_RESET_PERCENT) {
      await db.delete(systemSettings).where(eq(systemSettings.key, key));
      return;
    }
    if (percentAfter < QUOTA_WARN_PERCENT) return;
    const tier = percentAfter >= QUOTA_FULL_PERCENT ? QUOTA_FULL_PERCENT : QUOTA_WARN_PERCENT;

    // Prise de palier atomique : seul l'appel qui écrit la sentinelle notifie.
    let claimed = (
      await db
        .insert(systemSettings)
        .values({ key, value: { tier } })
        .onConflictDoNothing()
        .returning({ key: systemSettings.key })
    ).length > 0;
    if (!claimed && tier === QUOTA_FULL_PERCENT) {
      claimed =
        (
          await db
            .update(systemSettings)
            .set({ value: { tier }, updatedAt: new Date() })
            .where(and(eq(systemSettings.key, key), sql`(${systemSettings.value}->>'tier')::int < ${tier}`))
            .returning({ key: systemSettings.key })
        ).length > 0;
    }
    if (!claimed) return;

    const admins = (await db
      .select({ userId: users.id, locale: users.locale })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(eq(organizationMembers.organizationId, orgId), inArray(organizationMembers.role, ["admin", "owner"]))
      )) as { userId: string; locale: string | null }[];

    const percent = Math.min(Math.floor(percentAfter), 100);
    for (const { userId, locale: l } of admins) {
      try {
        const locale = l ?? FALLBACK_LOCALE;
        const t = createTranslator({
          locale,
          messages: await loadMessages(locale),
          namespace: `library.notify.${tier === QUOTA_FULL_PERCENT ? "quotaFull" : "quotaWarn"}`,
        } as never) as unknown as (k: string, v: Record<string, number>) => string;
        await createNotification({
          userId,
          type: "media",
          title: t("title", { percent }),
          message: t("message", { percent }),
        });
      } catch (err) {
        logger.error({ err, userId, orgId }, "Notification de quota en échec");
      }
    }
  } catch (err) {
    logger.error({ err, orgId }, "Notification de quota en échec");
  }
}

/**
 * Après une libération d'espace (purge, effacement) : lève la sentinelle de
 * quota si l'usage est repassé sous 75 %. Ne lève jamais.
 */
export async function refreshQuotaSentinel(orgId: string): Promise<void> {
  try {
    const [used, limit] = await Promise.all([getOrgStorageUsedBytes(orgId), getHooks().usage.getOrgStorageLimitBytes(orgId)]);
    if (!limit || limit <= 0) return;
    if ((used / limit) * 100 < QUOTA_RESET_PERCENT) {
      await db.delete(systemSettings).where(eq(systemSettings.key, `${QUOTA_SENTINEL_PREFIX}${orgId}`));
    }
  } catch (err) {
    logger.warn({ err, orgId }, "Réarmement de la sentinelle de quota en échec");
  }
}
