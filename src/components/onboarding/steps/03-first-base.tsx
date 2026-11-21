// loriax-app/src/components/onboarding/steps/03-first-base.tsx
import type { StepDef } from "./index";

export const step03: StepDef = {
  id: "first-base",
  title: "Ta première base",
  body: () => (
    <>
      <p>
        Une <strong>base</strong> structure tes informations comme un tableau : contacts, tâches,
        prestations, suivi clients…
      </p>
      <p className="mt-2">
        Ajoute une ligne, change le type d’une colonne, puis bascule en <strong>vue kanban</strong>{" "}
        en un clic.
      </p>
    </>
  ),
  targetSelector: "[data-tour='base-create']",
  path: () => "/bases",
};
