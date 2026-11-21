/**
 * Source unique des usages IA affichés dans l'administration.
 *
 * Chaque valeur de l'énumération PostgreSQL `ai_usage_type` doit apparaître
 * ici, avec un libellé français lisible par un utilisateur non technique.
 * L'identifiant technique ne doit jamais être affiché tel quel : quand un
 * usage manque dans ces tables, les écrans (journaux, tableau de bord, export
 * CSV) retombent sur la chaîne brute, et l'usage devient invisible dans les
 * filtres.
 *
 * La liste est volontairement recopiée en dur plutôt qu'importée du schéma
 * Drizzle : ce module est consommé par des composants client, et le schéma
 * n'a rien à faire dans le bundle navigateur. Le test
 * `usage-labels.test.ts` garantit que la copie reste alignée sur l'énumération.
 */

export const AI_USAGE_TYPES = [
  "chat",
  "summary_doc",
  "summary_meeting",
  "embeddings",
  "playground",
  "database_ai_create",
  "database_ai_formula",
  "automation_ai",
  "help",
  "voice_note_summary",
  "voice_note_cleanup",
  "rerank",
] as const;

export type AiUsageType = (typeof AI_USAGE_TYPES)[number];

/** Libellés complets, pour les écrans qui disposent de place (tableaux, formulaires). */
export const AI_USAGE_LABELS: Record<AiUsageType, string> = {
  chat: "Chat RAG",
  summary_doc: "Résumé document",
  summary_meeting: "Résumé réunion",
  embeddings: "Embeddings",
  playground: "Playground",
  database_ai_create: "Création de base par IA",
  database_ai_formula: "Aide à la formule des bases",
  automation_ai: "Action IA des automatisations",
  help: "Assistant d'aide",
  voice_note_summary: "Synthèse note vocale",
  voice_note_cleanup: "Mise au propre note vocale",
  rerank: "Reclassement des recherches",
};

/** Libellés courts, pour les colonnes serrées et les légendes de graphiques. */
export const AI_USAGE_SHORT_LABELS: Record<AiUsageType, string> = {
  chat: "Chat",
  summary_doc: "Résumé doc",
  summary_meeting: "Résumé réunion",
  embeddings: "Embeddings",
  playground: "Playground",
  database_ai_create: "Création de base",
  database_ai_formula: "Aide formule",
  automation_ai: "Automatisations",
  help: "Assistant d'aide",
  voice_note_summary: "Synthèse note vocale",
  voice_note_cleanup: "Mise au propre note vocale",
  rerank: "Reclassement",
};

/** Couleurs hexadécimales, pour les graphiques du tableau de bord IA. */
export const AI_USAGE_COLORS: Record<AiUsageType, string> = {
  chat: "#6366f1",
  summary_doc: "#f59e0b",
  summary_meeting: "#10b981",
  embeddings: "#8b5cf6",
  playground: "#ec4899",
  database_ai_create: "#f43f5e",
  database_ai_formula: "#84cc16",
  automation_ai: "#f97316",
  help: "#64748b",
  voice_note_summary: "#0ea5e9",
  voice_note_cleanup: "#14b8a6",
  rerank: "#0ea5e9",
};

/** Classes de badge Tailwind, pour les pastilles d'usage des prompts. */
export const AI_USAGE_BADGE_CLASSES: Record<AiUsageType, string> = {
  chat: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  summary_doc: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  summary_meeting: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  embeddings: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  playground: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  database_ai_create: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  database_ai_formula: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400",
  automation_ai: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  help: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  voice_note_summary: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  voice_note_cleanup: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  rerank: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
};

/**
 * Usages dont le modèle est résolu par `getLanguageModelForUsageInOrg` /
 * `resolveEmbeddingProviderInOrg`, donc réellement pilotables depuis l'écran
 * « Fournisseurs IA ». Seuls ceux-là ont droit à une ligne d'affectation :
 * proposer un réglage sans effet serait pire que de ne rien proposer.
 */
export const AI_USAGE_TYPES_ASSIGNABLE: readonly AiUsageType[] = [
  "chat",
  "summary_doc",
  "summary_meeting",
  "embeddings",
  "automation_ai",
  "help",
  "voice_note_summary",
  "voice_note_cleanup",
  "rerank",
];

/**
 * Usages volontairement absents de l'écran d'affectation, avec la raison.
 * Tout nouvel usage doit être classé ici ou dans la liste ci-dessus : le test
 * de complétude échoue sinon.
 */
export const AI_USAGE_TYPES_NOT_ASSIGNABLE: Record<string, string> = {
  // Le fournisseur et le modèle sont choisis explicitement à chaque essai,
  // dans l'écran Playground lui-même.
  playground: "Le modèle est choisi à chaque essai dans l'écran Playground.",
  // Ces deux routes appellent `getLanguageModel()` (variables d'environnement
  // DEFAULT_AI_PROVIDER / DEFAULT_AI_MODEL) et non le résolveur par usage.
  database_ai_create:
    "Le modèle vient de la configuration serveur, pas d'une affectation par usage.",
  database_ai_formula:
    "Le modèle vient de la configuration serveur, pas d'une affectation par usage.",
};

/** Libellé complet d'un usage, avec repli sûr sur l'identifiant inconnu. */
export function aiUsageLabel(usageType: string): string {
  return AI_USAGE_LABELS[usageType as AiUsageType] ?? usageType;
}

/** Libellé court d'un usage, avec repli sûr sur l'identifiant inconnu. */
export function aiUsageShortLabel(usageType: string): string {
  return AI_USAGE_SHORT_LABELS[usageType as AiUsageType] ?? usageType;
}

/** Options `{ value, label }` prêtes pour un filtre ou une liste déroulante. */
export function aiUsageOptions(
  types: readonly AiUsageType[] = AI_USAGE_TYPES,
  labels: Record<AiUsageType, string> = AI_USAGE_LABELS,
): { value: AiUsageType; label: string }[] {
  return types.map((value) => ({ value, label: labels[value] }));
}
