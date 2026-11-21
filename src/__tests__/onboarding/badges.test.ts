// Tests d'intégration pour la lib onboarding/badges.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { onboardingProgress, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  initProgress,
  recordOnboardingEvent,
  markTourStep,
  getProgress,
} from "@/lib/onboarding/progress";
import { TOUR_STEP_COUNT } from "@/lib/onboarding/types";

const U = "00000000-0000-0000-0000-000000000002";
const EMAIL = "onboarding-badges-test@loriax.local";

// Intégration : vraie base, lancée par `npm run test:integration` (DATABASE_URL requis).
describe.skipIf(!process.env.DATABASE_URL)("onboarding/badges", () => {
  beforeAll(async () => {
    await db
      .insert(users)
      .values({ id: U, email: EMAIL, name: "Onboarding Badges Test" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, U));
  });

  beforeEach(async () => {
    await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, U));
  });

  it("attribue le badge unitaire à la 1re création d'un kind", async () => {
    await initProgress(U);
    await recordOnboardingEvent(U, "doc");
    const p = await getProgress(U);
    expect(p?.badges.some((b) => b.id === "doc")).toBe(true);
  });

  it("attribue tutorial_complete à la dernière étape du tour", async () => {
    await initProgress(U);
    await markTourStep(U, TOUR_STEP_COUNT);
    const p = await getProgress(U);
    expect(p?.badges.some((b) => b.id === "tutorial_complete")).toBe(true);
  });

  it("attribue le badge presentation à la 1re présentation créée", async () => {
    await initProgress(U);
    await recordOnboardingEvent(U, "presentation");
    const p = await getProgress(U);
    expect(p?.steps.presentation).toBeDefined();
    expect(p?.badges.some((b) => b.id === "presentation")).toBe(true);
  });

  it("attribue first_collab après recordOnboardingEvent('partage')", async () => {
    await initProgress(U);
    await recordOnboardingEvent(U, "partage");
    const p = await getProgress(U);
    expect(p?.badges.some((b) => b.id === "first_collab")).toBe(true);
  });
});
