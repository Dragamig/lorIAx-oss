import { useEffect, useMemo, useState } from "react";
import type { DbColumn, DbData, DbRow } from "./types";
import { fetchJson } from "./api";

export type RelationData = Record<string, { rows: DbRow[]; columns: DbColumn[] }>;

/** Bases cibles distinctes des colonnes relation, triées (clé stable). */
export function relationTargetIds(columns: DbColumn[]): string[] {
  const ids: string[] = [];
  for (const col of columns) {
    if (col.type === "relation" && col.config?.targetDatabaseId && !ids.includes(col.config.targetDatabaseId)) {
      ids.push(col.config.targetDatabaseId);
    }
  }
  return ids.sort();
}

// Dédoublonnage des requêtes en vol (React StrictMode, vues montées ensemble) ;
// l'entrée est retirée à l'arrivée pour ne jamais servir de lignes périmées.
const inflight = new Map<string, Promise<{ rows: DbRow[]; columns: DbColumn[] }>>();

function loadTarget(dbId: string) {
  let p = inflight.get(dbId);
  if (!p) {
    p = fetchJson<DbData>(`/api/databases/${dbId}`)
      .then((r) => ({ rows: r.rows, columns: r.columns }))
      .catch(() => ({ rows: [] as DbRow[], columns: [] as DbColumn[] }))
      .finally(() => {
        inflight.delete(dbId);
      });
    inflight.set(dbId, p);
  }
  return p;
}

/** Précharge lignes et colonnes des bases ciblées par les colonnes relation. */
export function useRelationData(columns: DbColumn[], reloadKey = 0): RelationData {
  const [relationData, setRelationData] = useState<RelationData>({});
  const key = useMemo(() => relationTargetIds(columns).join(","), [columns]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    // Chaque base cible alimente l'état dès qu'elle arrive (pas d'attente de la plus lente).
    for (const id of key.split(",")) {
      void loadTarget(id).then((val) => {
        if (!cancelled) setRelationData((prev) => ({ ...prev, [id]: val }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key, reloadKey]);

  return relationData;
}
