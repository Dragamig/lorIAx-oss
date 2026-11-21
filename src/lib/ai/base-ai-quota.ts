import { db } from "@/lib/db";
import { aiUsageLogs } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { getHooks } from "@/lib/modules/hooks";

/**
 * Quotas IA Free pour l'Espace Bases (Phases 7.5 / 8.5).
 *
 * - 10 créations de base par IA / utilisateur / 24h
 * - 50 aides formule par IA / utilisateur / 24h
 *
 * Skip silencieux hors plan Free (hook `entitlements.isFreePlan`, toujours faux sans module commercial).
 * Le décompte s'appuie sur `ai_usage_logs` filtré par `usage_type`.
 */

const FREE_LIMITS = {
  database_ai_create: 10,
  database_ai_formula: 50,
} as const;

export type BaseAIQuotaKind = keyof typeof FREE_LIMITS;

export interface BaseAIQuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  isFreePlan: boolean;
}

export async function checkBaseAIQuota(
  userId: string,
  kind: BaseAIQuotaKind,
): Promise<BaseAIQuotaResult> {
  const limit = FREE_LIMITS[kind];
  const free = await getHooks().entitlements.isFreePlan();
  if (!free) return { allowed: true, used: 0, limit, isFreePlan: false };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiUsageLogs)
    .where(
      and(
        eq(aiUsageLogs.userId, userId),
        eq(aiUsageLogs.usageType, kind),
        gte(aiUsageLogs.createdAt, since),
      ),
    );

  const used = Number(row?.count ?? 0);
  return { allowed: used < limit, used, limit, isFreePlan: true };
}
