import { isColumnTypeCompatible } from "@/lib/databases/column-types";
import type { ColumnFact } from "./automap";
import { CRM_FIELDS, type CrmFieldDef, type CrmRole } from "./fields";

export type FieldState =
  | { state: "ok" }
  | { state: "none" }
  | {
      state: "bad";
      code: "column_missing" | "type_incompatible" | "relation_target";
      message: string;
    };

const MESSAGES = {
  column_missing: "crm.errors.columnMissing",
  type_incompatible: "crm.errors.typeIncompatible",
  relation_target: "crm.errors.relationTarget",
} as const;

function bad(code: keyof typeof MESSAGES): FieldState {
  return { state: "bad", code, message: MESSAGES[code] };
}

export function validateField(
  def: CrmFieldDef,
  columnId: string | null | undefined,
  columns: readonly ColumnFact[],
  expectedTargetDatabaseId?: string | null,
): FieldState {
  if (!columnId) return { state: "none" };
  const column = columns.find((c) => c.id === columnId);
  if (!column) return bad("column_missing");
  if (!isColumnTypeCompatible(def.types, column.type)) return bad("type_incompatible");
  if (def.relationTargetRole) {
    if (!expectedTargetDatabaseId || column.targetDatabaseId !== expectedTargetDatabaseId) {
      return bad("relation_target");
    }
  }
  return { state: "ok" };
}

export function validateRole(
  role: CrmRole,
  fieldMap: Record<string, string | null>,
  columns: readonly ColumnFact[],
  targets: Partial<Record<CrmRole, string | null>>,
): {
  fields: Record<string, FieldState>;
  ok: number;
  total: number;
  bad: number;
  complete: boolean;
} {
  const fields: Record<string, FieldState> = {};
  let ok = 0;
  let badCount = 0;
  let complete = true;
  for (const def of CRM_FIELDS[role]) {
    const expected = def.relationTargetRole ? targets[def.relationTargetRole] : undefined;
    const state = validateField(def, fieldMap[def.key], columns, expected);
    fields[def.key] = state;
    if (state.state === "ok") ok++;
    else if (state.state === "bad") badCount++;
    if (def.required && state.state !== "ok") complete = false;
  }
  return { fields, ok, total: CRM_FIELDS[role].length, bad: badCount, complete };
}
