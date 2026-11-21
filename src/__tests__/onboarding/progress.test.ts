// Tests d'intégration pour la lib onboarding/progress.
// Utilisent la BDD de dev (cf. DATABASE_URL).
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { onboardingProgress, users } from "@/lib/db/schema";
import {
  getProgress,
  recordOnboardingEvent,
  markTourStep,
  dismissTour,
  initProgress,
} from "@/lib/onboarding/progress";
import { TOUR_STEP_COUNT } from "@/lib/onboarding/types";
import { eq } from "drizzle-orm";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_EMAIL = "onboarding-progress-test@loriax.local";

// Intégration : vraie base, lancée par `npm run test:integration` (DATABASE_URL requis).
describe.skipIf(!process.env.DATABASE_URL)("onboarding/progress", () => {
  beforeAll(async () => {
    await db
      .insert(users)
      .values({
        id: TEST_USER_ID,
        email: TEST_USER_EMAIL,
        name: "Onboarding Progress Test",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(onboardingProgress)
      .where(eq(onboardingProgress.userId, TEST_USER_ID));
    // On laisse l'user fixture en place : il peut être référencé par d'autres tables (FKs).
  });

  beforeEach(async () => {
    await db
      .delete(onboardingProgress)
      .where(eq(onboardingProgress.userId, TEST_USER_ID));
  });

  it("initProgress crée une ligne avec startedAt = now", async () => {
    const row = await initProgress(TEST_USER_ID);
    expect(row.userId).toBe(TEST_USER_ID);
    expect(row.startedAt).not.toBeNull();
    expect(row.currentStep).toBe(0);
  });

  it("markTourStep incrémente currentStep et complete à la dernière étape", async () => {
    await initProgress(TEST_USER_ID);
    await markTourStep(TEST_USER_ID, 3);
    let p = await getProgress(TEST_USER_ID);
    expect(p?.currentStep).toBe(3);
    expect(p?.completedAt).toBeNull();
    await markTourStep(TEST_USER_ID, TOUR_STEP_COUNT);
    p = await getProgress(TEST_USER_ID);
    expect(p?.currentStep).toBe(TOUR_STEP_COUNT);
    expect(p?.completedAt).not.toBeNull();
  });

  it("recordOnboardingEvent coche une étape réelle (1re fois seulement)", async () => {
    await initProgress(TEST_USER_ID);
    await recordOnboardingEvent(TEST_USER_ID, "doc");
    const p = await getProgress(TEST_USER_ID);
    expect(p?.steps.doc).toBeDefined();
    const ts1 = p!.steps.doc;
    await recordOnboardingEvent(TEST_USER_ID, "doc");
    const p2 = await getProgress(TEST_USER_ID);
    expect(p2?.steps.doc).toBe(ts1);
  });

  it("dismissTour set dismissedAt", async () => {
    await initProgress(TEST_USER_ID);
    await dismissTour(TEST_USER_ID);
    const p = await getProgress(TEST_USER_ID);
    expect(p?.dismissedAt).not.toBeNull();
  });
});
