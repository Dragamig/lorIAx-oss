import type { DbColumn, DbListItem } from "./types";

export type PairingInfo =
  | { kind: "none" }
  | { kind: "oneway"; targetDatabaseId: string; targetDatabaseName: string }
  | {
      kind: "paired";
      targetDatabaseId: string;
      targetDatabaseName: string;
      inverseColumnId: string;
      /** Null tant que la base cible n'est pas chargée. */
      inverseColumnName: string | null;
    };

type RelationData = Record<string, { columns: DbColumn[] }>;

/** Décrit l'état de jumelage d'une colonne (sens unique, jumelée, ou pas une relation). */
export function describePairing(
  column: Pick<DbColumn, "type" | "config">,
  relationData: RelationData,
  allDatabases: Pick<DbListItem, "id" | "name">[],
): PairingInfo {
  if (column.type !== "relation") return { kind: "none" };
  const targetId = column.config?.targetDatabaseId;
  if (!targetId) return { kind: "none" };
  const targetName = allDatabases.find((d) => d.id === targetId)?.name ?? "base liée";
  const inverseId = column.config?.inverseColumnId;
  if (typeof inverseId !== "string" || !inverseId) {
    return { kind: "oneway", targetDatabaseId: targetId, targetDatabaseName: targetName };
  }
  const inverse = relationData[targetId]?.columns.find((c) => c.id === inverseId);
  return {
    kind: "paired",
    targetDatabaseId: targetId,
    targetDatabaseName: targetName,
    inverseColumnId: inverseId,
    inverseColumnName: inverse?.name ?? null,
  };
}

/** Libellé d'info-bulle du badge de jumelage. */
export function pairingLabel(info: PairingInfo): string {
  if (info.kind === "paired") {
    return info.inverseColumnName
      ? `Jumelée avec ${info.targetDatabaseName} › ${info.inverseColumnName}`
      : `Jumelée avec une colonne de ${info.targetDatabaseName}`;
  }
  if (info.kind === "oneway") {
    return `Sens unique : aucune colonne inverse dans ${info.targetDatabaseName}`;
  }
  return "";
}
