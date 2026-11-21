/**
 * Interpolation des placeholders d'automatisation — module pur (sans I/O).
 *
 * Extrait de `executor.ts` pour être partagé entre l'exécuteur (actions
 * webhook/email/ai) et les actions d'écriture de lignes (create_row/update_row)
 * et testable isolément.
 *
 * Placeholders reconnus dans une chaîne :
 *   - `{{rowId}}`        → id de la ligne déclencheuse (contexte base)
 *   - `{{databaseId}}`   → id de la base (contexte base)
 *   - `{{event}}`        → type d'événement déclencheur
 *   - `{{cells.<col>}}`  → valeur de cellule (par id ou nom de colonne, selon
 *                          la clé présente dans le payload)
 *   - `{{space.id}}`     → id de l'espace (contexte workflow autonome)
 *   - `{{doc.id}}`       → id du document déclencheur (bouton)
 *   - `{{user.id}}`      → id de l'utilisateur déclencheur
 *   - `{{user.email}}`   → email de l'utilisateur déclencheur
 *   - `{{user.name}}`    → nom de l'utilisateur déclencheur
 *   - `{{today}}`, `{{today+N}}`, `{{today-N}}` → date AAAA-MM-JJ (Europe/Paris)
 *   - `{{now}}`          → horodatage ISO complet
 *   - `{{variables.<chemin>}}` → variable issue d'une étape précédente
 *                          (résultat d'action stocké via `storeAs`)
 *
 * Aucune évaluation arbitraire : substitution littérale de clés connues. Les
 * valeurs absentes deviennent une chaîne vide.
 */

/** Source du motif d'un placeholder : chemins pointés, tirets (uuid) et signe + (today+N). */
export const PLACEHOLDER_PATTERN = "\\{\\{\\s*([\\w.+-]+)\\s*\\}\\}";

/** Nouvelle expression régulière globale (état `lastIndex` propre à chaque appel). */
export function placeholderRegex(): RegExp {
  return new RegExp(PLACEHOLDER_PATTERN, "g");
}

const DATE_TOKEN_RE = /^(?:now|today(?:[+-]\d+)?)$/;

/** Vrai pour `now`, `today`, `today+N`, `today-N`. */
export function isDateToken(path: string): boolean {
  return DATE_TOKEN_RE.test(path);
}

let clock: () => Date = () => new Date();

/** Injecte une horloge (tests). `null` restaure l'horloge système. */
export function setAutomationClock(fn: (() => Date) | null): void {
  clock = fn ?? (() => new Date());
}

const PARIS_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function resolveDateToken(path: string): string {
  const now = clock();
  if (path === "now") return now.toISOString();
  const offset = Number(path.slice("today".length) || 0);
  const [y, m, d] = PARIS_DATE.format(now).split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + offset));
  return shifted.toISOString().slice(0, 10);
}

export interface InterpolationPayload {
  event?: string;
  // Contexte base-lié (déclencheurs row_*/cron/date/value).
  databaseId?: string;
  rowId?: string;
  cells?: Record<string, unknown>;
  // Contexte workflow autonome (déclencheur manuel : bouton dans un document).
  spaceId?: string;
  documentId?: string;
  user?: { id?: string; email?: string; name?: string };
  // Variables accumulées entre étapes d'un graphe (résultats d'actions
  // précédentes, stockés via `storeAs`). Accès par chemin pointé :
  // `{{variables.<nom>.<sous.champ>}}`.
  variables?: Record<string, unknown>;
}

/** Résout un chemin pointé (`a.b.c`) dans un objet. Renvoie undefined si absent. */
function resolvePath(root: unknown, path: string): unknown {
  let cur = root;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function interpolate(
  template: string,
  payload: InterpolationPayload,
  extra?: Record<string, string>
): string {
  return template.replace(placeholderRegex(), (_match, path: string) => {
    if (isDateToken(path)) return resolveDateToken(path);
    if (path === "rowId") return payload.rowId ?? "";
    if (path === "databaseId") return payload.databaseId ?? "";
    if (path === "event") return payload.event ?? "";
    if (path === "space.id") return payload.spaceId ?? "";
    if (path === "doc.id") return payload.documentId ?? "";
    if (path === "user.id") return payload.user?.id ?? "";
    if (path === "user.email") return payload.user?.email ?? "";
    if (path === "user.name") return payload.user?.name ?? "";
    if (path.startsWith("cells.")) {
      const key = path.slice("cells.".length);
      const cells = payload.cells;
      let v: unknown;
      if (cells && Object.prototype.hasOwnProperty.call(cells, key)) {
        v = cells[key];
      } else {
        // `cells.<colonne>.<chemin>` : premier segment = id de colonne, reste = chemin
        // (indices de tableau compris), comme pour `variables.`.
        const dot = key.indexOf(".");
        v = dot > 0 ? resolvePath(cells?.[key.slice(0, dot)], key.slice(dot + 1)) : undefined;
      }
      if (v === undefined || v === null) return "";
      return typeof v === "string" ? v : JSON.stringify(v);
    }
    if (path.startsWith("variables.")) {
      const v = resolvePath(payload.variables, path.slice("variables.".length));
      if (v === undefined || v === null) return "";
      return typeof v === "string" ? v : JSON.stringify(v);
    }
    // Canal `extra` : valeurs de mapping (data-binding) résolues pour des clés
    // nues (placeholders de template, sans préfixe). Consulté après les clés
    // connues du payload, mais avant le fallback vide.
    if (extra && Object.prototype.hasOwnProperty.call(extra, path)) return extra[path];
    return "";
  });
}

/**
 * Interpole un mapping de cellules `{ [columnId]: template }` destiné à une
 * action create_row / update_row. Les valeurs chaîne sont interpolées ; les
 * valeurs non-chaîne (nombre, booléen, tableau déjà résolu) sont conservées
 * telles quelles. Les clés vides sont ignorées.
 */
export function interpolateCells(
  template: Record<string, unknown>,
  payload: InterpolationPayload
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [columnId, value] of Object.entries(template)) {
    if (!columnId) continue;
    out[columnId] = interpolateValue(value, payload);
  }
  return out;
}

/** Interpole récursivement chaînes, tableaux et objets ; autres types inchangés. */
function interpolateValue(value: unknown, payload: InterpolationPayload): unknown {
  if (typeof value === "string") return interpolate(value, payload);
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, payload));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateValue(v, payload);
    return out;
  }
  return value;
}
