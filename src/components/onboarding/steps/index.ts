// loriax-app/src/components/onboarding/steps/index.ts
// Registre ordonné des 10 étapes du tour guidé.

import type { ReactNode } from "react";

export interface StepCtx {
  demoSpaceSlug: string;
}

export interface StepDef {
  id: string;
  /**
   * Titre littéral de l'étape. Les étapes traduites renseignent `titleKey`
   * à la place, et laissent ce champ vide.
   */
  title?: string;
  /** Clé i18n racine du titre, résolue par le moteur du tour. */
  titleKey?: string;
  body: (ctx: StepCtx) => ReactNode;
  targetSelector: string;
  /**
   * Chemin (locale-aware) vers lequel naviguer à l'entrée de l'étape, pour que
   * l'élément ciblé par `targetSelector` soit présent dans le DOM. Optionnel :
   * une étape dont la cible vit dans la sidebar (présente partout) peut s'en passer.
   */
  path?: (ctx: StepCtx) => string;
  onEnter?: (ctx: StepCtx) => void | Promise<void>;
  /**
   * Nettoyage à la sortie de l'étape (changement d'étape ou fermeture du tour).
   * Utile pour refermer une UI ouverte par `onEnter`, par exemple la palette de
   * commandes de l'étape 8.
   */
  onLeave?: (ctx: StepCtx) => void | Promise<void>;
  /**
   * Module dont dépend l'étape. Quand un administrateur l'a coupé, la page
   * ciblée rend un 404 : l'étape est alors retirée du tour, qui compte une
   * étape de moins sans jamais casser sa numérotation affichée.
   */
  requiresModule?: string;
}

import { step01 } from "./01-welcome-space";
import { step02 } from "./02-first-document";
import { step03 } from "./03-first-base";
import { step04 } from "./04-first-meeting";
import { step05 } from "./05-calendar";
import { step06 } from "./06-tasks";
import { step07 } from "./07-presentation";
import { step08 } from "./08-ai-assistant";
import { step09 } from "./09-command-palette";
import { step10 } from "./10-recap";

export const steps: StepDef[] = [
  step01,
  step02,
  step03,
  step04,
  step05,
  step06,
  step07,
  step08,
  step09,
  step10,
];
