/**
 * Coercition des cellules interpolées selon le type de la colonne cible.
 * Module pur (sans I/O). Les colonnes de type inconnu ou non géré sont
 * laissées telles quelles.
 */

export type ColumnTypeMap = Record<string, string>;

const TRUE_WORDS = new Set(["true", "1", "oui", "yes", "on", "vrai", "x"]);

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function coerceRelation(v: unknown): { omit: true } | { value: string[] } {
  const items = Array.isArray(v) ? v : [v];
  const ids = items
    .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
  return ids.length > 0 ? { value: ids } : { omit: true };
}

/**
 * Convertit les valeurs de `cells` (clé = id de colonne) vers le type de leur
 * colonne. Une valeur vide ou inconvertible est omise (clé absente du résultat).
 */
export function coerceCellsByColumnType(
  cells: Record<string, unknown>,
  columnTypes: ColumnTypeMap
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(cells)) {
    const type = columnTypes[key];
    switch (type) {
      case "relation": {
        const r = coerceRelation(raw);
        if ("value" in r) out[key] = r.value;
        break;
      }
      case "number": {
        if (typeof raw === "number") {
          if (Number.isFinite(raw)) out[key] = raw;
        } else if (typeof raw === "string" && raw.trim() !== "") {
          const n = Number(raw.trim().replace(",", "."));
          if (Number.isFinite(n)) out[key] = n;
        }
        break;
      }
      case "checkbox": {
        if (typeof raw === "boolean") out[key] = raw;
        else if (typeof raw === "number") out[key] = raw !== 0;
        else if (typeof raw === "string") out[key] = TRUE_WORDS.has(raw.trim().toLowerCase());
        break;
      }
      case "date": {
        if (typeof raw === "string") {
          const t = raw.trim();
          if (t !== "" && !Number.isNaN(new Date(t).getTime())) out[key] = t;
        } else if (!isEmpty(raw)) {
          out[key] = raw;
        }
        break;
      }
      default:
        out[key] = raw;
    }
  }
  return out;
}

export type RelationMode = "replace" | "append";

/**
 * Colonnes à fusionner par union (« ajouter aux liens existants ») : uniquement
 * des colonnes de type relation présentes dans `cells`. Mode par colonne
 * (`relationModes`) prioritaire sur le mode de l'action (`relationMode`).
 */
export function appendRelationColumns(
  cfg: { relationMode?: unknown; relationModes?: unknown },
  cells: Record<string, unknown>,
  columnTypes: ColumnTypeMap
): string[] {
  const perColumn =
    cfg.relationModes && typeof cfg.relationModes === "object"
      ? (cfg.relationModes as Record<string, unknown>)
      : {};
  return Object.keys(cells).filter((col) => {
    if (columnTypes[col] !== "relation") return false;
    const mode = perColumn[col] ?? cfg.relationMode;
    return mode === "append";
  });
}
