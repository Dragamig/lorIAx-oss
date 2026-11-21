import type { DbColumnType } from "@/lib/databases/column-types";
import type { ColumnFact } from "./automap";
import { CRM_FIELDS, type CrmRole } from "./fields";
import { validateField } from "./validate";
import { normalizeTemplateName } from "@/lib/databases/templates/columns";

export type MissingCause = "absent" | "wrong_type";

export interface MissingColumn {
  fieldKey: string;
  name: string;
  type: DbColumnType;
  cause: MissingCause;
  existingName?: string;
}

export type CandidateStatus = "compatible" | "almost" | "none";

/** Comparaison de noms : une seule implémentation, côté générateur de bases. */
export const normalizeName = normalizeTemplateName;

/** `Base (type)`, puis `Base (type) 2`, `Base (type) 3`, jusqu'à un nom libre. */
export function fallbackColumnName(base: string, type: string, taken: readonly string[]): string {
  const used = new Set(taken.map(normalizeName));
  const first = `${base} (${type})`;
  if (!used.has(normalizeName(first))) return first;
  for (let n = 2; ; n++) {
    const candidate = `${first} ${n}`;
    if (!used.has(normalizeName(candidate))) return candidate;
  }
}

export function planMissing(
  role: CrmRole,
  columns: readonly ColumnFact[],
  fieldMap: Record<string, string | null>,
  opts: { fieldLabel: (key: string) => string; relationTargetKnown: boolean },
): MissingColumn[] {
  const taken = columns.map((c) => c.name);
  const out: MissingColumn[] = [];
  for (const def of CRM_FIELDS[role]) {
    const col = columns.find((c) => c.id === fieldMap[def.key]);
    if (validateField(def, fieldMap[def.key], columns, col?.targetDatabaseId ?? null).state === "ok") continue;
    if (def.types[0] === "relation" && !opts.relationTargetKnown) continue;
    const type = def.types[0];
    const label = opts.fieldLabel(def.key);
    const sameName = columns.find((c) => normalizeName(c.name) === normalizeName(label));
    let item: MissingColumn;
    if (sameName && !isSameTypeAccepted(def.types, sameName.type)) {
      item = {
        fieldKey: def.key,
        name: fallbackColumnName(label, type, taken),
        type,
        cause: "wrong_type",
        existingName: sameName.name,
      };
    } else {
      const name = taken.some((t) => normalizeName(t) === normalizeName(label))
        ? fallbackColumnName(label, type, taken)
        : label;
      item = { fieldKey: def.key, name, type, cause: "absent" };
    }
    taken.push(item.name);
    out.push(item);
  }
  return out;
}

function isSameTypeAccepted(types: readonly DbColumnType[], actual: string): boolean {
  return (types as readonly string[]).includes(actual);
}

export function classifyCandidate(
  role: CrmRole,
  columns: readonly ColumnFact[],
  fieldMap: Record<string, string | null>,
  relationTargetKnown: boolean,
  fieldLabel: (key: string) => string = (key) => key,
): { status: CandidateStatus; missing: MissingColumn[] } {
  const missing = planMissing(role, columns, fieldMap, { fieldLabel, relationTargetKnown });
  let requiredFound = 0;
  let requiredMissing = 0;
  let unaddable = false;
  for (const def of CRM_FIELDS[role]) {
    if (!def.required) continue;
    const col = columns.find((c) => c.id === fieldMap[def.key]);
    const ok = validateField(def, fieldMap[def.key], columns, col?.targetDatabaseId ?? null).state === "ok";
    if (ok) requiredFound++;
    else {
      requiredMissing++;
      if (def.types[0] === "relation" && !relationTargetKnown) unaddable = true;
    }
  }
  if (requiredMissing === 0) return { status: "compatible", missing };
  if (requiredFound > 0 && !unaddable) return { status: "almost", missing };
  return { status: "none", missing };
}
