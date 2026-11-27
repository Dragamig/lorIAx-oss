// loriax-app/src/components/onboarding/steps/06-tasks.tsx
import type { StepDef } from "./index";

export const step06: StepDef = {
  id: "tasks",
  title: "Tes tâches",
  body: () => (
    <>
      <p>
        Cette page rassemble <strong>toutes les tâches qui te sont assignées</strong>, qu’elles
        viennent d’une case à cocher dans un document ou d’un événement de calendrier. Un lien te
        ramène à chaque fois vers sa source.
      </p>
      <p className="mt-2">
        Les tâches sont regroupées par statut : à faire, en cours, terminée, annulée. Tu changes le
        statut en cliquant sur son étiquette. Les échéances s’affichent à côté du titre.
      </p>
      <p className="mt-2">
        Le petit compteur à droite de « Mes tâches », dans la barre latérale, indique en permanence
        combien de tâches restent ouvertes.
      </p>
    </>
  ),
  targetSelector: "[data-tour='nav-tasks']",
  path: () => "/tasks",
};
