// loriax-app/src/lib/onboarding/badges.ts
// Règles d'attribution des badges d'onboarding.

import { db } from "@/lib/db";
import { onboardingProgress } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type {
  BadgeId,
  OnboardingProgressRow,
  OnboardingStepKey,
} from "./types";

const BONUS_GROUPS = ["docAdvanced", "goFurther"] as const;

async function getRow(userId: string): Promise<OnboardingProgressRow | null> {
  const [row] = await db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, userId))
    .limit(1);
  return (row as OnboardingProgressRow | undefined) ?? null;
}

async function appendBadge(userId: string, id: BadgeId): Promise<void> {
  const row = await getRow(userId);
  if (!row) return;
  if (row.badges.some((b) => b.id === id)) return;
  const nextBadges = [
    ...row.badges,
    { id, awardedAt: new Date().toISOString() },
  ];
  await db
    .update(onboardingProgress)
    .set({ badges: nextBadges, updatedAt: new Date() })
    .where(eq(onboardingProgress.userId, userId));
}

/**
 * Attribue les badges déclenchés après un recordOnboardingEvent (kind).
 * - badge unitaire dont l'ID = kind
 * - first_collab si kind === "partage"
 */
export async function awardBadgesAfterEvent(
  userId: string,
  kind: OnboardingStepKey,
): Promise<void> {
  // badge unitaire (id = kind)
  await appendBadge(userId, kind);
  if (kind === "partage") {
    await appendBadge(userId, "first_collab");
  }
}

export async function awardTutorialCompleteBadge(
  userId: string,
): Promise<void> {
  await appendBadge(userId, "tutorial_complete");
}

/**
 * Attribue le badge "explorer" si toutes les sous-checklists bonus sont remplies.
 * Placeholder : seuils précis définis ultérieurement (cf. plan Task 4 — bonus checklists).
 */
export async function awardExplorerBadgeIfComplete(
  userId: string,
): Promise<void> {
  const row = await getRow(userId);
  if (!row) return;
  const allBonusDone = BONUS_GROUPS.every((g) => {
    const group = row.bonusSteps[g];
    return Object.keys(group).length > 0;
  });
  if (allBonusDone) await appendBadge(userId, "explorer");
}
