// loriax-app/src/components/onboarding/steps/08-ai-assistant.tsx
import type { StepDef } from "./index";

export const step08: StepDef = {
  id: "ai-assistant",
  title: "L’assistant IA",
  body: () => (
    <>
      <p>
        Pose tes questions <strong>sur tes propres documents</strong> : l’assistant va chercher les
        passages pertinents dans les espaces auxquels tu as accès, puis te répond en s’appuyant
        dessus. Rien de ce que tu n’as pas le droit de voir n’entre dans sa réponse.
      </p>
      <p className="mt-2">
        Quelques suggestions te sont proposées au démarrage : résumer un document, retrouver les
        liens entre deux sujets, chercher une information.
      </p>
      <p className="mt-2">
        L’IA travaille aussi ailleurs dans l’app : résumé automatique d’un document depuis
        l’éditeur, et compte rendu généré à la fin d’une réunion en visio à partir de sa
        transcription.
      </p>
    </>
  ),
  targetSelector: "[data-tour='nav-ai']",
  path: () => "/ai",
};
