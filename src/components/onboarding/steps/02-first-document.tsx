// loriax-app/src/components/onboarding/steps/02-first-document.tsx
import type { StepDef } from "./index";

export const step02: StepDef = {
  id: "first-document",
  title: "Ton premier document",
  body: () => (
    <>
      <p>
        Dans ton document, tape <strong>« / »</strong> pour ouvrir le slash menu : titres, listes,
        images, bases de données, et bien plus.
      </p>
      <p className="mt-2">
        Tu peux aussi insérer une image, mentionner un autre document avec <strong>@</strong> ou
        demander à l’<strong>IA</strong> de rédiger un brouillon pour toi.
      </p>
    </>
  ),
  targetSelector: "[data-tour='editor-slash-menu']",
  // Le slash menu n'existe dans le DOM que pendant la frappe de « / » : on ouvre
  // un nouveau document de l'espace démo et on garde l'explication en modale centrée.
  path: ({ demoSpaceSlug }) => `/s/${demoSpaceSlug}/new`,
};
