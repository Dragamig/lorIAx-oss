// loriax-app/src/lib/onboarding/progress.ts
// Lib core onboarding : initialisation, suivi des étapes, événements réels.

import { db } from "@/lib/db";
import { onboardingProgress } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { OnboardingProgressRow, OnboardingStepKey } from "./types";
import { TOUR_STEP_COUNT } from "./types";
import { awardBadgesAfterEvent, awardTutorialCompleteBadge } from "./badges";
import { isDemoSpace } from "./demo-space";

export async function getProgress(
  userId: string,
): Promise<OnboardingProgressRow | null> {
  const [row] = await db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, userId))
    .limit(1);
  return (row as OnboardingProgressRow | undefined) ?? null;
}

export async function initProgress(
  userId: string,
): Promise<OnboardingProgressRow> {
  const existing = await getProgress(userId);
  if (existing) return existing;
  const [row] = await db
    .insert(onboardingProgress)
    .values({ userId, startedAt: new Date(), currentStep: 0 })
    .returning();
  return row as OnboardingProgressRow;
}

export async function markTourStep(userId: string, step: number): Promise<void> {
  const existing = await getProgress(userId);
  if (!existing) await initProgress(userId);
  const completedAt = step >= TOUR_STEP_COUNT ? new Date() : null;
  await db
    .update(onboardingProgress)
    .set({
      currentStep: step,
      ...(completedAt ? { completedAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(onboardingProgress.userId, userId));
  if (completedAt) {
    await awardTutorialCompleteBadge(userId);
  }
}

export async function dismissTour(userId: string): Promise<void> {
  const existing = await getProgress(userId);
  if (!existing) await initProgress(userId);
  await db
    .update(onboardingProgress)
    .set({ dismissedAt: new Date(), updatedAt: new Date() })
    .where(eq(onboardingProgress.userId, userId));
}

export async function recordOnboardingEvent(
  userId: string,
  kind: OnboardingStepKey,
): Promise<void> {
  const existing = await getProgress(userId);
  if (!existing) {
    await initProgress(userId);
  }
  const current = (await getProgress(userId))!;
  if (current.steps[kind]) return; // idempotent : 1re occurrence seulement
  const nextSteps = { ...current.steps, [kind]: new Date().toISOString() };
  await db
    .update(onboardingProgress)
    .set({ steps: nextSteps, updatedAt: new Date() })
    .where(eq(onboardingProgress.userId, userId));
  await awardBadgesAfterEvent(userId, kind);
}

/**
 * Enregistre un événement onboarding uniquement si le spaceId fourni ne correspond
 * pas à l'espace démo. Si spaceId est null, enregistre l'événement directement.
 */
export async function recordIfRealSpace(
  userId: string,
  kind: OnboardingStepKey,
  spaceId: string | null,
): Promise<void> {
  if (!spaceId) {
    await recordOnboardingEvent(userId, kind);
    return;
  }
  if (await isDemoSpace(spaceId)) return;
  await recordOnboardingEvent(userId, kind);
}
