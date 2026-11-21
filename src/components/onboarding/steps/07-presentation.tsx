// loriax-app/src/components/onboarding/steps/07-presentation.tsx
import { useTranslations } from "next-intl";
import type { StepDef } from "./index";

/**
 * Corps de l'étape rendu comme un composant : les textes viennent de
 * `messages/*.json`, et `useTranslations` ne peut être appelé que dans un
 * composant, pas dans la fonction `body` évaluée par le moteur du tour.
 */
function PresentationBody() {
  const t = useTranslations("onboarding.tour.presentation");
  return (
    <>
      <p>{t("body1")}</p>
      <p className="mt-2">{t("body2")}</p>
    </>
  );
}

export const step07: StepDef = {
  id: "presentation",
  titleKey: "onboarding.tour.presentation.title",
  body: () => <PresentationBody />,
  targetSelector: "[data-tour='presentations-create']",
  path: () => "/presentations",
  // L'étape disparaît du tour quand l'administrateur a coupé le module :
  // /presentations rend alors un 404 et le tour enverrait l'utilisateur
  // sur une page qui n'existe plus.
  requiresModule: "presentations",
};
