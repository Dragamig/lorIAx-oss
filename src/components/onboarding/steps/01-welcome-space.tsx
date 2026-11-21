// loriax-app/src/components/onboarding/steps/01-welcome-space.tsx
import type { StepDef } from "./index";

export const step01: StepDef = {
  id: "welcome-space",
  title: "Bienvenue dans LorIAx !",
  body: () => (
    <>
      <p>On commence par créer ton espace. Un espace = un projet, une équipe ou un thème.</p>
      <p className="mt-2">
        Tu es déjà dans ton espace démo « Découverte LorIAx ». Cherche le bouton{" "}
        <strong>Nouvel espace</strong> dans la sidebar pour en créer un vrai.
      </p>
    </>
  ),
  targetSelector: "[data-tour='sidebar-new-space']",
  path: () => "/",
};
