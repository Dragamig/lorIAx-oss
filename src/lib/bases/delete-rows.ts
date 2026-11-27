import { apiDelete, apiPost } from "@/components/editor/extensions/database-block/api";
import type { CellValue } from "@/components/editor/extensions/database-block/types";

export type ServerRow = { id: string; cells: Record<string, CellValue>; position: number };

/** Supprime des lignes et renvoie les lignes telles que le serveur les a retirées (champ `tracking` inclus). */
export function deleteRowsRequest(databaseId: string, rowIds: string[]): Promise<{ deleted: ServerRow[] }> {
  return apiDelete<{ deleted: ServerRow[] }>(`/api/databases/${databaseId}/rows`, { rowIds });
}

/** Restaure les lignes renvoyées par `deleteRowsRequest`. `alreadyRestored: true` vaut succès. */
export function restoreRowsRequest(databaseId: string, deleted: ServerRow[]) {
  return apiPost<{ alreadyRestored?: boolean } | undefined>(`/api/databases/${databaseId}/rows/restore`, {
    rows: deleted,
  });
}
