import { isColumnTypeCompatible } from "@/lib/databases/column-types";
import { CRM_FIELDS, type CrmRole } from "./fields";

export interface ColumnFact {
  id: string;
  name: string;
  type: string;
  targetDatabaseId?: string | null;
}

/** Minuscules sans accents : « Téléphone » doit répondre à l'indice « tel ». */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Propose une colonne par champ : première colonne de type accepté dont le nom contient un indice, sans doublon. */
export function automapRole(
  role: CrmRole,
  columns: readonly ColumnFact[],
): Record<string, string | null> {
  const used = new Set<string>();
  const out: Record<string, string | null> = {};
  for (const def of CRM_FIELDS[role]) {
    const found = columns.find((c) => {
      if (used.has(c.id)) return false;
      if (!isColumnTypeCompatible(def.types, c.type)) return false;
      const name = fold(c.name);
      return def.hints.some((h) => name.includes(fold(h)));
    });
    out[def.key] = found ? found.id : null;
    if (found) used.add(found.id);
  }
  return out;
}
