// loriax-app/src/components/onboarding/steps/04-first-meeting.tsx
import type { StepDef } from "./index";

export const step04: StepDef = {
  id: "first-meeting",
  title: "Planifier une réunion",
  body: () => (
    <>
      <p>
        Crée un événement et bascule entre <strong>visio</strong> (Meet intégré) et{" "}
        <strong>présentiel</strong> (champ lieu).
      </p>
      <p className="mt-2">
        Ajoute des participants : ils recevront une invitation et l’événement sera ajouté à leur
        agenda.
      </p>
    </>
  ),
  targetSelector: "[data-tour='calendar-create-event']",
  path: () => "/calendar",
};
