// loriax-app/src/lib/onboarding/types.ts
// Types pour le tuto guidé d'onboarding (Feature 1)

export type OnboardingStepKey =
  | "space"
  | "doc"
  | "base"
  | "event"
  | "visio"
  | "partage"
  | "tasks"
  | "presentation"
  | "ai"
  | "palette";

export type BadgeId =
  | "space"
  | "doc"
  | "base"
  | "event"
  | "visio"
  | "partage"
  | "tasks"
  | "presentation"
  | "ai"
  | "palette"
  | "tutorial_complete"
  | "first_collab"
  | "explorer";

/**
 * Événements que le client peut déclencher lui-même via POST /api/onboarding/event.
 * Volontairement restreint : les autres clés sont posées côté serveur, au moment
 * où l'action réelle est réalisée, pour qu'un badge ne puisse pas être auto-attribué.
 */
export const CLIENT_EVENT_KINDS = ["palette"] as const satisfies readonly OnboardingStepKey[];

export type ClientEventKind = (typeof CLIENT_EVENT_KINDS)[number];

export interface OnboardingProgressRow {
  userId: string;
  startedAt: Date | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
  currentStep: number;
  steps: Partial<Record<OnboardingStepKey, string>>;
  bonusSteps: {
    docAdvanced: Record<string, string>;
    goFurther: Record<string, string>;
  };
  badges: Array<{ id: BadgeId; awardedAt: string }>;
  createdAt?: Date;
  updatedAt?: Date;
}

export const TOUR_STEP_COUNT = 10;
