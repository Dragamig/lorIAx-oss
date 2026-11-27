import { z } from "zod";
import type { FilterGroup } from "@/components/editor/extensions/database-block/types";
import { newFilterId } from "@/components/editor/extensions/database-block/filter-tree";

export const QUERY_FILTER_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "is_before",
  "is_after",
] as const;

export const QUERY_FILTER_MAX_CONDITIONS = 10;

/** Sous-ensemble de FilterGroup exposé au modèle : un seul niveau, 10 conditions max. */
export const queryFilterSchema = z.object({
  conjunction: z.enum(["and", "or"]),
  conditions: z
    .array(
      z.object({
        columnId: z.string(),
        operator: z.enum(QUERY_FILTER_OPERATORS),
        value: z.string(),
      }),
    )
    .max(QUERY_FILTER_MAX_CONDITIONS),
});

export type QueryFilterInput = z.infer<typeof queryFilterSchema>;

/** Convertit l'entrée du modèle en FilterGroup (`children`, ids générés). */
export function toFilterGroup(input: QueryFilterInput): FilterGroup {
  return {
    id: newFilterId(),
    type: "group",
    conjunction: input.conjunction,
    children: input.conditions.map((c) => ({
      id: newFilterId(),
      columnId: c.columnId,
      operator: c.operator,
      value: c.value,
    })),
  };
}
