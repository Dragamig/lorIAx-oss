/** Valeurs de l'enum de colonne `column_type` (schema.ts). */
export type DbColumnType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "relation"
  | "image"
  | "formula"
  | "url"
  | "email"
  | "attachment"
  | "time"
  | "autonumber"
  | "person"
  | "document_link";

/** Vrai si `actual` figure parmi les types attendus ; faux pour un type inconnu. */
export function isColumnTypeCompatible(
  expected: readonly DbColumnType[],
  actual: string,
): boolean {
  return (expected as readonly string[]).includes(actual);
}

/** Clés de message `crm.types.<type>` pour l'interface. */
export function describeColumnTypes(types: readonly DbColumnType[]): string[] {
  return types.map((t) => `crm.types.${t}`);
}
