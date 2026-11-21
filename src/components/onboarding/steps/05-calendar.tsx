// loriax-app/src/components/onboarding/steps/05-calendar.tsx
import type { StepDef } from "./index";

export const step05: StepDef = {
  id: "calendar",
  title: "Ton calendrier",
  body: () => (
    <>
      <p>
        Voici ton calendrier en <strong>vue semaine</strong>. Tu peux glisser-déposer les
        événements pour les déplacer ou les redimensionner.
      </p>
      <p className="mt-2">
        L’événement que tu viens de créer apparaît ici. Tu peux superposer plusieurs calendriers
        (perso, équipe, projet).
      </p>
    </>
  ),
  targetSelector: "[data-tour='calendar-week-view']",
  path: () => "/calendar?view=week",
  onEnter: async () => {
    try {
      await fetch("/api/calendars/ensure-personal", { method: "POST" });
    } catch {
      /* ignore */
    }
  },
};
