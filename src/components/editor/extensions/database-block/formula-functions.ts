// ─── Référence des fonctions de formule (source unique de vérité) ────────────
// Décrit les fonctions supportées par formula-evaluator.ts. Consommée par :
//   • la page d'aide in-app `/bases/aide-formules`
//   • le prompt du générateur IA de formules (`/api/databases/ai-formula`)
// Toute fonction ajoutée à l'évaluateur doit être documentée ici.

export interface FormulaFunctionDoc {
  /** Signature affichée, ex. `dateadd(date, n, unit)`. */
  signature: string;
  /** Description courte en français. */
  description: string;
  /** Exemple `formule → résultat` (optionnel). */
  example?: string;
}

export interface FormulaCategory {
  key: string;
  label: string;
  functions: FormulaFunctionDoc[];
  /** Note ajoutée au prompt IA pour cette catégorie. */
  promptNote?: string;
}

export const FORMULA_CATEGORIES: FormulaCategory[] = [
  {
    key: "columns",
    label: "Accès aux colonnes",
    promptNote: "entre guillemets, sensible à la casse",
    functions: [
      {
        signature: 'prop("Nom de la colonne")',
        description:
          "Valeur d'une autre colonne de la ligne. Le nom est sensible à la casse.",
        example: 'prop("Quantité") * prop("Prix")',
      },
    ],
  },
  {
    key: "math",
    label: "Maths",
    functions: [
      { signature: "abs(x)", description: "Valeur absolue.", example: "abs(0 - 5) → 5" },
      { signature: "round(x)", description: "Arrondi à l'entier le plus proche.", example: "round(3.6) → 4" },
      { signature: "floor(x)", description: "Arrondi à l'entier inférieur." },
      { signature: "ceil(x)", description: "Arrondi à l'entier supérieur." },
      { signature: "sqrt(x)", description: "Racine carrée." },
      { signature: "pow(x, y)", description: "x à la puissance y." },
      { signature: "min(...)", description: "Plus petite valeur des arguments." },
      { signature: "max(...)", description: "Plus grande valeur des arguments." },
    ],
  },
  {
    key: "text",
    label: "Texte",
    functions: [
      { signature: "concat(...)", description: "Concatène les arguments.", example: 'concat("Mme ", prop("Nom"))' },
      { signature: "length(s)", description: "Longueur de la chaîne." },
      { signature: "lower(s)", description: "Passe en minuscules." },
      { signature: "upper(s)", description: "Passe en majuscules." },
      { signature: "contains(s, sous)", description: "Vrai si s contient la sous-chaîne." },
    ],
  },
  {
    key: "logic",
    label: "Logique",
    functions: [
      { signature: "if(cond, a, b)", description: "Renvoie a si cond est vraie, sinon b.", example: 'if(prop("Stock") > 0, "Dispo", "Rupture")' },
      { signature: "and(...)", description: "Vrai si tous les arguments sont vrais." },
      { signature: "or(...)", description: "Vrai si au moins un argument est vrai." },
      { signature: "not(x)", description: "Inverse un booléen." },
      { signature: "empty(x)", description: "Vrai si la valeur est vide (null, \"\", liste vide)." },
    ],
  },
  {
    key: "date",
    label: "Date",
    promptNote: 'unit ∈ "years|months|weeks|days|hours|minutes|seconds" · fmt ex. "YYYY-MM-DD"',
    functions: [
      { signature: "today()", description: "Date du jour (sans l'heure)." },
      { signature: "now()", description: "Date et heure courantes." },
      { signature: "dateadd(date, n, unit)", description: "Décale une date de n unités (n peut être négatif).", example: 'dateadd(prop("Début"), 7, "days")' },
      { signature: "datetime_diff(d1, d2, unit)", description: "Différence d1 − d2 dans l'unité, tronquée.", example: 'datetime_diff(prop("Fin"), prop("Début"), "days")' },
      { signature: "datetime_format(date, fmt)", description: "Formate une date selon un masque (YYYY MM DD HH mm ss).", example: 'datetime_format(prop("Date"), "DD/MM/YYYY")' },
      { signature: "year(date)", description: "Année (nombre)." },
      { signature: "month(date)", description: "Mois 1–12." },
      { signature: "day(date)", description: "Jour du mois." },
      { signature: "weekday(date, [début])", description: 'Jour de la semaine 0–6 (dimanche=0 ; "Monday" pour lundi=0).' },
      { signature: "is_before(d1, d2)", description: "Vrai si d1 est avant d2." },
      { signature: "is_after(d1, d2)", description: "Vrai si d1 est après d2." },
      { signature: "is_same(d1, d2, [unit])", description: "Égalité à la granularité de l'unité (jour par défaut ; sans unité = exacte)." },
    ],
  },
  {
    key: "time",
    label: "Heure (HH:MM)",
    functions: [
      { signature: "hour(t)", description: "Heures d'une valeur \"HH:MM\".", example: 'hour("14:30") → 14' },
      { signature: "minute(t)", description: "Minutes d'une valeur \"HH:MM\"." },
      { signature: "formattime(t, fmt)", description: "Renvoie l'heure telle quelle." },
      { signature: "timediff(t1, t2)", description: "Écart en minutes entre deux heures.", example: 'timediff("08:00", "14:30") → 390' },
      { signature: "addminutes(t, n)", description: "Ajoute n minutes à une heure.", example: 'addminutes("14:30", 90) → "16:00"' },
      { signature: "nowtime()", description: "Heure courante \"HH:MM\"." },
    ],
  },
];

/** Opérateurs supportés par l'évaluateur. */
export const FORMULA_OPERATORS = "+ - * / % == != > < >= <=";

/**
 * Construit la référence textuelle injectée dans le prompt du générateur IA.
 * Format compact : une ligne par catégorie (signatures), puis les opérateurs.
 */
export function buildFormulaPromptReference(): string {
  const lines = FORMULA_CATEGORIES.map((c) => {
    const sigs = c.functions.map((f) => f.signature).join(", ");
    const note = c.promptNote ? ` — ${c.promptNote}` : "";
    return `- ${c.label} : ${sigs}${note}`;
  });
  return [
    "Fonctions disponibles :",
    ...lines,
    "",
    `Opérateurs : ${FORMULA_OPERATORS}`,
  ].join("\n");
}
