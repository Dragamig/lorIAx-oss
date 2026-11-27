import type { RowSnapshot } from "@/lib/databases/row-batch";

export type RowFingerprint = { id: string; hash: string };

/** Empreinte de fraîcheur calculée à la planification, recomparée à l'apply. */
export type Freshness = {
  rows: RowFingerprint[];
  /** Fusion : nombre de lignes de la base partageant la clé au calcul (une ligne qui rejoint le groupe rend la proposition périmée). */
  databaseRowCountForKey?: number;
};

export type MergeConflict = {
  columnId: string;
  chosenFrom: string;
  candidates: { rowId: string; value: unknown }[];
};

/** Relation unidirectionnelle d'une ligne hors groupe pointant vers une ligne retirée : repointée vers la conservée. */
export type RepointedRelation = {
  rowId: string;
  databaseId: string;
  columnId: string;
  /** Valeur d'origine de la cellule. L'`after` se recalcule à l'apply (buildMergeWrites), selon les seuls groupes retenus. */
  before: string[];
};

export type MergeGroup = {
  groupId: string;
  keepRowId: string;
  removeRowIds: string[];
  /** Cellules non relationnelles à écrire sur la ligne conservée (complétées, pièces jointes réunies), sans les conflits ni les relations. */
  mergedCells: Record<string, unknown>;
  /** Valeurs actuelles de la conservée pour les colonnes de `mergedCells` (cellule absente = null). */
  keepBefore: Record<string, unknown>;
  /** Copie complète de la ligne conservée : les relations s'unissent à l'apply selon les groupes retenus. */
  keepRow: RowSnapshot;
  /** Copie complète des lignes retirées, pour l'annulation (y compris une ligne cible de relation d'une autre ligne retirée). */
  removedRows: RowSnapshot[];
  conflicts: MergeConflict[];
  repatriation: { relationCells: number; attachments: number; repointed: RepointedRelation[] };
  excluded?: boolean;
};

/** Convention : une cellule absente est stockée à `null` dans tout `before` (mise à jour, fusion). */
export type ProposalPayload =
  | {
      type: "update_rows";
      changes: { rowId: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
    }
  | { type: "delete_rows"; rows: RowSnapshot[] }
  | { type: "create_rows"; rows: { cells: Record<string, unknown> }[] }
  | { type: "merge_duplicates"; keyColumnIds: string[]; relationColumnIds: string[]; groups: MergeGroup[] };

export type UndoSnapshot = {
  restoredRows?: RowSnapshot[];
  previousCells?: { rowId: string; cells: Record<string, unknown> }[];
  /** `databaseId` : base de la ligne porteuse (relation unidirectionnelle, souvent une autre base). */
  repointedRelations?: { databaseId: string; rowId: string; columnId: string; before: unknown }[];
  createdRowIds?: string[];
  postApply: RowFingerprint[];
};

export type ProposalPlanErrorCode =
  | "unknown_row"
  | "invalid_cells"
  | "too_many_rows"
  | "unknown_column"
  | "empty"
  | "scan_limit";

/** Erreur de planification : message sûr, destiné au modèle. Partagée par les planificateurs (tâches 11 et 12). */
export class ProposalPlanError extends Error {
  constructor(
    public readonly code: ProposalPlanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProposalPlanError";
  }
}

export type ProposalSummary = { summary: string; rowCount: number; conflictCount: number };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Résumé, nombre de lignes et conflits, dérivés du payload (rien n'est stocké).
 * Accepte une ligne `ai_proposals` ou tout objet portant `payload`. Formulation à l'infinitif :
 * une proposition n'est jamais décrite comme déjà faite.
 */
export function summarizeProposal(input: { payload: ProposalPayload }): ProposalSummary {
  const p = input.payload;
  switch (p.type) {
    case "update_rows": {
      const n = p.changes.length;
      return { summary: `Mettre à jour ${plural(n, "ligne", "lignes")}`, rowCount: n, conflictCount: 0 };
    }
    case "delete_rows": {
      const n = p.rows.length;
      return { summary: `Supprimer ${plural(n, "ligne", "lignes")}`, rowCount: n, conflictCount: 0 };
    }
    case "create_rows": {
      const n = p.rows.length;
      return { summary: `Créer ${plural(n, "ligne", "lignes")}`, rowCount: n, conflictCount: 0 };
    }
    case "merge_duplicates": {
      const groups = p.groups.filter((g) => !g.excluded);
      const removed = groups.reduce((s, g) => s + g.removeRowIds.length, 0);
      const conflicts = groups.reduce((s, g) => s + g.conflicts.length, 0);
      const parts = [
        `Regrouper ${plural(groups.length, "groupe de doublons", "groupes de doublons")}`,
        `${plural(removed, "ligne à retirer", "lignes à retirer")}`,
      ];
      if (conflicts > 0) parts.push(plural(conflicts, "conflit pré-tranché", "conflits pré-tranchés"));
      return { summary: parts.join(", "), rowCount: removed, conflictCount: conflicts };
    }
  }
}
