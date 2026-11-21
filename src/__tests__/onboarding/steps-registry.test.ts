// Cohérence du registre du tour guidé : nombre d'étapes, clés d'étapes et
// invariant des événements que le client a le droit de déclencher lui-même.
import { describe, it, expect, vi } from "vitest";

// `@/i18n/routing` tire la navigation next-intl, qui exige le runtime Next :
// hors de propos ici, le registre n'est inspecté que sur ses métadonnées.
vi.mock("@/i18n/routing", () => ({
  Link: () => null,
  useRouter: () => ({ push: () => {} }),
}));

import { steps } from "@/components/onboarding/steps";
import { CLIENT_EVENT_KINDS, TOUR_STEP_COUNT } from "@/lib/onboarding/types";

describe("onboarding/steps", () => {
  it("compte exactement TOUR_STEP_COUNT étapes", () => {
    expect(steps).toHaveLength(TOUR_STEP_COUNT);
  });

  it("expose une étape présentation qui mène à /presentations", () => {
    const step = steps.find((s) => s.id === "presentation");
    expect(step).toBeDefined();
    expect(step?.path?.({ demoSpaceSlug: "demo" })).toBe("/presentations");
    expect(step?.targetSelector).toBe("[data-tour='presentations-create']");
  });

  it("retire l'étape présentation quand le module est coupé", () => {
    const step = steps.find((s) => s.id === "presentation");
    expect(step?.requiresModule).toBe("presentations");
    const withoutModule = steps.filter(
      (s) => !s.requiresModule || ["autre"].includes(s.requiresModule),
    );
    expect(withoutModule.map((s) => s.id)).not.toContain("presentation");
    expect(withoutModule).toHaveLength(TOUR_STEP_COUNT - 1);
  });

  it("donne un titre à chaque étape, littéral ou traduit", () => {
    for (const s of steps) {
      expect(Boolean(s.title || s.titleKey)).toBe(true);
    }
  });

  it("n'ouvre pas le badge presentation à une auto-attribution client", () => {
    expect(CLIENT_EVENT_KINDS).not.toContain("presentation");
  });
});
