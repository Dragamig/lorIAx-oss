// loriax-app/src/components/onboarding/steps/09-command-palette.tsx
import type { StepDef } from "./index";

export const step09: StepDef = {
  id: "command-palette",
  title: "La palette de commandes",
  body: () => (
    <>
      <p>
        Appuie sur <strong>Ctrl+K</strong> (ou <strong>Cmd+K</strong> sur Mac) depuis n’importe
        quelle page : la palette s’ouvre par-dessus ton travail. C’est le chemin le plus court vers
        tout le reste.
      </p>
      <p className="mt-2">
        Tape deux lettres et la <strong>recherche de documents</strong> se lance en direct, avec
        l’espace d’origine de chaque résultat. Les flèches ↑ ↓ naviguent, Entrée ouvre, Escape
        ferme.
      </p>
      <p className="mt-2">
        En dessous, les actions rapides : accueil, recherche avancée, graphe de connaissances,
        assistant IA, nouveau document, paramètres.
      </p>
    </>
  ),
  targetSelector: "[data-tour='command-palette']",
  // Pas de `path` : la palette est montée dans le layout applicatif, elle est
  // donc disponible sur n’importe quelle page.
  onEnter: () => {
    window.dispatchEvent(new CustomEvent("loriax:command-palette-open"));
  },
  onLeave: () => {
    window.dispatchEvent(new CustomEvent("loriax:command-palette-close"));
  },
};
