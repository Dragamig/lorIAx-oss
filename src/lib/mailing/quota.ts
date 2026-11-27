/**
 * Quotas d'envoi de mails : plafond par offre (par organisation, 24 h depuis le
 * premier mail de la fenetre, fenetre fixe) et anti-abus par utilisateur.
 * Compte par destinataire. `checkRateLimit` est proscrit : `peekQuotaExceeded`
 * puis `consumeQuota` uniquement.
 */
import { getHooks } from "@/lib/modules/hooks";
import type { Plan } from "@/lib/license/types";
import { consumeQuota, peekQuotaExceeded } from "@/lib/rate-limit";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export const MAIL_QUOTA_BY_PLAN: Record<Plan, number | null> = {
  free: 50,
  growth: 500,
  enterprise: null,
};

export const MAIL_PLAN_WINDOW_MS = 86_400_000;
export const MAIL_ABUSE_TIERS: readonly RateLimitConfig[] = [{ maxRequests: 200, windowMs: 3_600_000 }];

const orgKey = (orgId: string) => `mail:org:${orgId}`;
const userKey = (userId: string) => `mail:user:${userId}`;

/** Refuse (sans consommer) si `count + n > limit`, grace a un seuil de pic `limit - n + 1`. */
async function wouldExceed(key: string, limit: number, n: number, windowMs: number): Promise<boolean> {
  const threshold = limit - n + 1;
  if (threshold <= 0) return true;
  return peekQuotaExceeded(key, [{ maxRequests: threshold, windowMs }]);
}

export type MailQuotaResult = { ok: true } | { ok: false; reason: "plan" | "abuse"; limit: number };

/**
 * Verifie puis consomme `count` destinataires. Tout ou rien : un refus ne consomme rien.
 * Sous forte concurrence un depassement de quelques unites reste possible (peek puis consume).
 */
export async function checkMailQuota(orgId: string, userId: string, count: number): Promise<MailQuotaResult> {
  const n = Math.max(1, Math.floor(count));
  const plan = await getHooks().usage.getOrgPlan(orgId);
  // Sans module d'offres (edition oss), aucun plafond lie a l'offre.
  const planLimit = plan === null ? null : MAIL_QUOTA_BY_PLAN[plan];
  const abuse = MAIL_ABUSE_TIERS[0];

  if (planLimit !== null && (await wouldExceed(orgKey(orgId), planLimit, n, MAIL_PLAN_WINDOW_MS))) {
    return { ok: false, reason: "plan", limit: planLimit };
  }
  if (await wouldExceed(userKey(userId), abuse.maxRequests, n, abuse.windowMs)) {
    return { ok: false, reason: "abuse", limit: abuse.maxRequests };
  }
  for (let i = 0; i < n; i++) {
    if (planLimit !== null) await consumeQuota(orgKey(orgId), [{ maxRequests: planLimit, windowMs: MAIL_PLAN_WINDOW_MS }]);
    await consumeQuota(userKey(userId), MAIL_ABUSE_TIERS);
  }
  return { ok: true };
}

/**
 * Lecture sans consommation. Seuil `limite + 1` : n'echoue que si le compteur a depasse
 * la limite (retrogradation d'offre), jamais pour le mail qui a pris le dernier jeton.
 */
export async function peekMailQuota(orgId: string, userId: string): Promise<{ exceeded: boolean; limit: number | null }> {
  const plan = await getHooks().usage.getOrgPlan(orgId);
  // Sans module d'offres (edition oss), aucun plafond lie a l'offre.
  const planLimit = plan === null ? null : MAIL_QUOTA_BY_PLAN[plan];
  const abuse = MAIL_ABUSE_TIERS[0];
  const planExceeded =
    planLimit !== null &&
    (await peekQuotaExceeded(orgKey(orgId), [{ maxRequests: planLimit + 1, windowMs: MAIL_PLAN_WINDOW_MS }]));
  const abuseExceeded = await peekQuotaExceeded(userKey(userId), [
    { maxRequests: abuse.maxRequests + 1, windowMs: abuse.windowMs },
  ]);
  return { exceeded: planExceeded || abuseExceeded, limit: planLimit };
}
