/**
 * Modèles de présentation livrés avec LorIAx.
 *
 * Les documents sont importés statiquement : ils sont embarqués dans le
 * bundle, sans lecture disque à l'exécution, ce que le build standalone exige.
 * Ils servent au semis d'une organisation, à la réinitialisation d'un modèle
 * et au repli de lecture quand l'objet S3 d'un modèle semé manque.
 *
 * Les documents ne portent pas de `docId` : l'identité d'un document
 * appartient à la copie de chaque organisation, pas au fichier du dépôt.
 */
import { deckSchema, type Deck } from "../deck";
import pitch from "./pitch.json";
import meetingNotes from "./meeting-notes.json";
import training from "./training.json";
import statusUpdate from "./status-update.json";

export type LorIAxTemplateSeedKey =
  | "pitch"
  | "meeting-notes"
  | "training"
  | "status-update";

export interface LorIAxTemplate {
  /** Clé stable du semis, stockée dans `template_seed_key`. */
  seedKey: LorIAxTemplateSeedKey;
  /** Clé i18n du nom affiché. */
  fileTitleKey: string;
  /** Clé i18n de la description affichée. */
  fileDescriptionKey: string;
  deck: Deck;
}

function entry(seedKey: LorIAxTemplateSeedKey, raw: unknown): LorIAxTemplate {
  return {
    seedKey,
    fileTitleKey: `presentations.templates.lorIAx.${seedKey}.name`,
    fileDescriptionKey: `presentations.templates.lorIAx.${seedKey}.description`,
    deck: deckSchema.parse(raw),
  };
}

export const LORIAX_TEMPLATES: readonly LorIAxTemplate[] = [
  entry("pitch", pitch),
  entry("meeting-notes", meetingNotes),
  entry("training", training),
  entry("status-update", statusUpdate),
];

export function getLorIAxTemplate(seedKey: string): LorIAxTemplate | undefined {
  return LORIAX_TEMPLATES.find((t) => t.seedKey === seedKey);
}
