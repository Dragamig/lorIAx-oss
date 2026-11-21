"use client";

import { useEffect, useState } from "react";
import type { PlaceholderGroup, PlaceholderOption } from "./placeholder-field";

/** Variables liées à l'utilisateur déclencheur — identiques dans tous les contextes. */
export const USER_PLACEHOLDER_GROUP: PlaceholderGroup = {
  group: "Utilisateur",
  options: [
    { label: "Utilisateur — ID", value: "{{user.id}}" },
    { label: "Utilisateur — E-mail", value: "{{user.email}}" },
    { label: "Utilisateur — Nom", value: "{{user.name}}" },
  ],
};

/** Options « Cellule : <nom> » insérant le code {{cells.<id>}}. */
export function cellsToOptions(columns: { id: string; name: string; type?: string }[]): PlaceholderOption[] {
  return columns.map((c) => ({ label: `Cellule : ${c.name}`, value: `{{cells.${c.id}}}`, ...(c.type ? { hint: c.type } : {}) }));
}

/**
 * Charge les colonnes d'une base (id + nom) pour alimenter les sélecteurs de
 * variables/conditions. Aucune base (workflow autonome) → liste vide.
 */
export type AutomationColumn = { id: string; name: string; type?: string };

export function useAutomationColumns(databaseId?: string): AutomationColumn[] {
  const [columns, setColumns] = useState<AutomationColumn[]>([]);
  useEffect(() => {
    if (!databaseId) {
      setColumns([]);
      return;
    }
    let active = true;
    fetch(`/api/databases/${databaseId}/columns`)
      .then((r) => (r.ok ? r.json() : { columns: [] }))
      .then((j) => {
        if (active && Array.isArray(j.columns)) setColumns(j.columns);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [databaseId]);
  return columns;
}

export type SpaceDatabase = { id: string; name: string };

/** Bases actives de l'espace (API existante /api/databases?spaceId=). */
export function useSpaceDatabases(spaceId: string): { databases: SpaceDatabase[]; loading: boolean } {
  const [databases, setDatabases] = useState<SpaceDatabase[]>([]);
  const [loading, setLoading] = useState(!!spaceId);
  useEffect(() => {
    if (!spaceId) return;
    let active = true;
    fetch(`/api/databases?spaceId=${encodeURIComponent(spaceId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => {
        if (active && Array.isArray(j)) {
          setDatabases(j.map((d: SpaceDatabase) => ({ id: d.id, name: d.name })));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [spaceId]);
  return { databases, loading };
}

/** Sorties exposées par type d'action sous `{{variables.<storeAs>.<chemin>}}`. */
const STEP_OUTPUTS: Record<string, { path: string; label: string }[]> = {
  create_row: [
    { path: "row.id", label: "identifiant de la ligne" },
    { path: "row.created", label: "ligne créée (oui/non)" },
  ],
  update_row: [{ path: "updatedRow.id", label: "identifiant de la ligne" }],
  find_row: [{ path: "foundRow.id", label: "identifiant de la ligne trouvée" }],
  create_document: [
    { path: "createdDocument.id", label: "identifiant du document" },
    { path: "createdDocument.title", label: "titre du document" },
    { path: "createdDocument.spaceSlug", label: "espace du document (slug)" },
    { path: "createdDocument.link", label: "lien document prêt pour une colonne Lien document (tableur de demande)" },
  ],
  create_task: [{ path: "createdTask.id", label: "identifiant de la tâche" }],
};

/** Mode de recherche de `find_row` : `rowId` présent (même vide) = par identifiant. */
export type FindRowMode = "column" | "id";

export function findRowModeOf(config: Record<string, unknown>): FindRowMode {
  return config.rowId !== undefined ? "id" : "column";
}

/**
 * Bascule le mode de `find_row`. Mode identifiant : `rowId` est conservé même
 * vide (sa présence porte le mode), `columnId`/`value` sont retirés. Mode
 * colonne : `rowId` est retiré.
 */
export function setFindRowMode(config: Record<string, unknown>, mode: FindRowMode): Record<string, unknown> {
  const next = { ...config };
  if (mode === "id") {
    delete next.columnId;
    delete next.value;
    if (next.rowId === undefined) next.rowId = "";
  } else {
    delete next.rowId;
  }
  return next;
}

/** Colonnes connues par base cible (clé : databaseId, "" pour la base de l'automatisation). */
export type ColumnsByDatabase = Record<string, AutomationColumn[]>;

/** Options de variables déduites des étapes amont (storeAs + type d'action). */
export function stepOutputOptions(
  upstream: { actionType?: string; storeAs?: string; actionConfig?: Record<string, unknown> }[],
  columnsByDb: ColumnsByDatabase = {}
): PlaceholderOption[] {
  const out: PlaceholderOption[] = [];
  for (const n of upstream) {
    if (!n.storeAs) continue;
    for (const o of STEP_OUTPUTS[n.actionType ?? ""] ?? []) {
      out.push({
        label: `${n.storeAs} : ${o.label}`,
        value: `{{variables.${n.storeAs}.${o.path}}}`,
      });
    }
    if (n.actionType === "find_row") {
      const dbId = typeof n.actionConfig?.databaseId === "string" ? n.actionConfig.databaseId : "";
      for (const c of columnsByDb[dbId] ?? []) {
        out.push({
          label: `${n.storeAs} : ${c.name}`,
          value: `{{variables.${n.storeAs}.foundRow.cells.${c.id}}}`,
          ...(c.type ? { hint: c.type } : {}),
        });
      }
    }
    out.push({ label: `${n.storeAs} : résultat complet`, value: `{{variables.${n.storeAs}}}` });
  }
  return out;
}

/** Charge les colonnes des bases cibles des étapes `find_row` amont (clé "" = base de l'automatisation, non chargée ici). */
export function useUpstreamFindRowColumns(
  upstream: { actionType?: string; actionConfig?: Record<string, unknown> }[]
): ColumnsByDatabase {
  const ids = Array.from(
    new Set(
      upstream
        .filter((n) => n.actionType === "find_row" && typeof n.actionConfig?.databaseId === "string")
        .map((n) => n.actionConfig!.databaseId as string)
    )
  ).sort();
  const key = ids.join(",");
  const [map, setMap] = useState<ColumnsByDatabase>({});
  useEffect(() => {
    let active = true;
    for (const id of key ? key.split(",") : []) {
      fetch(`/api/databases/${id}/columns`)
        .then((r) => (r.ok ? r.json() : { columns: [] }))
        .then((j) => {
          if (active && Array.isArray(j.columns)) setMap((m) => ({ ...m, [id]: j.columns }));
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [key]);
  return map;
}
