/**
 * Réglage « Actions de l'assistant IA » : quels outils de base de données le
 * chat peut utiliser, par organisation. Stocké dans `system_settings` sous la
 * clé `chat_actions:<orgId>` (pas de migration : la table est clé/valeur).
 */
export type ChatActionsSettings = {
  /** Interrupteur maître : éteint, le chat n'a aucun outil (FAQ renforcée). */
  actionsEnabled: boolean;
  /** Outils de lecture (lister, décrire, interroger, doublons). Requis par les propositions. */
  readDatabases: boolean;
  proposeUpdates: boolean;
  proposeDeletes: boolean;
  proposeMerges: boolean;
  proposeCreates: boolean;
  /** Création de fichiers : indépendante de la lecture des bases, soumise au seul interrupteur maître. */
  proposeSpreadsheets: boolean;
  proposeDocuments: boolean;
  proposePresentations: boolean;
};

export const CHAT_ACTIONS_FIELDS = [
  "actionsEnabled",
  "readDatabases",
  "proposeUpdates",
  "proposeDeletes",
  "proposeMerges",
  "proposeCreates",
  "proposeSpreadsheets",
  "proposeDocuments",
  "proposePresentations",
] as const satisfies readonly (keyof ChatActionsSettings)[];

/**
 * Valeurs par défaut prudentes (décision produit) : lecture, modification et
 * création ouvertes ; suppression et fusion fermées tant que l'administrateur
 * ne les active pas. Toute écriture reste une proposition validée par un clic.
 */
export const DEFAULT_CHAT_ACTIONS: ChatActionsSettings = {
  actionsEnabled: true,
  readDatabases: true,
  proposeUpdates: true,
  proposeDeletes: false,
  proposeMerges: false,
  proposeCreates: true,
  proposeSpreadsheets: true,
  proposeDocuments: true,
  proposePresentations: false,
};

/** Tout activé : valeur de repli des fabriques d'outils et de règles appelées sans réglage (tests, appelants internes). */
export const ALL_ON_CHAT_ACTIONS: ChatActionsSettings = {
  actionsEnabled: true,
  readDatabases: true,
  proposeUpdates: true,
  proposeDeletes: true,
  proposeMerges: true,
  proposeCreates: true,
  proposeSpreadsheets: true,
  proposeDocuments: true,
  proposePresentations: true,
};

/** Tout éteint : repli si la lecture du réglage échoue (fail-closed, le chat reste une FAQ). */
export const ALL_OFF_CHAT_ACTIONS: ChatActionsSettings = {
  actionsEnabled: false,
  readDatabases: false,
  proposeUpdates: false,
  proposeDeletes: false,
  proposeMerges: false,
  proposeCreates: false,
  proposeSpreadsheets: false,
  proposeDocuments: false,
  proposePresentations: false,
};

export function chatActionsKey(orgId: string): string {
  return `chat_actions:${orgId}`;
}

/** Applique les dépendances : maître éteint = tout éteint ; chaque proposition sur les bases exige la lecture (pas la création de fichiers). */
export function resolveEffectiveChatActions(s: ChatActionsSettings): ChatActionsSettings {
  if (!s.actionsEnabled) return { ...ALL_OFF_CHAT_ACTIONS };
  if (!s.readDatabases) {
    return {
      ...ALL_OFF_CHAT_ACTIONS,
      actionsEnabled: true,
      proposeSpreadsheets: s.proposeSpreadsheets,
      proposeDocuments: s.proposeDocuments,
      proposePresentations: s.proposePresentations,
    };
  }
  return { ...s };
}

/**
 * Lit la valeur stockée telle que l'administrateur l'a réglée : un champ absent
 * ou non booléen reprend son défaut, sans appliquer les dépendances (les
 * sous-options gardent leur état quand le maître est éteint, pour l'écran).
 */
export function parseChatActionsSettings(raw: unknown): ChatActionsSettings {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_CHAT_ACTIONS };
  for (const field of CHAT_ACTIONS_FIELDS) {
    if (typeof source[field] === "boolean") out[field] = source[field] as boolean;
  }
  return out;
}

/** Valeur effective : lecture normalisée, puis dépendances appliquées. C'est elle que le serveur applique. */
export function normalizeChatActionsSettings(raw: unknown): ChatActionsSettings {
  return resolveEffectiveChatActions(parseChatActionsSettings(raw));
}
