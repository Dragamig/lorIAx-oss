import { loadColumnTypes } from "@/lib/databases/row-writes";
import { PROPOSAL_MAX_ROWS } from "@/lib/ai/chat-tools/limits";
import { ProposalPlanError, summarizeProposal } from "./types";
import type { Freshness, ProposalPayload } from "./types";

export type ProposalPlan = {
  payload: ProposalPayload;
  freshness: Freshness;
  summary: string;
  rowCount: number;
};

/** Types que le modèle ne peut pas écrire : calculés, ou portant des fichiers et liens non fournis en v1. */
const COMPUTED_TYPES = new Set(["formula", "autonumber"]);
const UNSUPPORTED_TYPES = new Set(["attachment", "image", "relation"]);

export function assertRowCount(n: number): void {
  if (n === 0) throw new ProposalPlanError("empty", "Aucune ligne fournie");
  if (n > PROPOSAL_MAX_ROWS) {
    throw new ProposalPlanError(
      "too_many_rows",
      `Trop de lignes (${n}) : une proposition en accepte ${PROPOSAL_MAX_ROWS} au plus. Restreindre le lot.`,
    );
  }
}

/** Valide les cellules fournies par le modèle contre les types de colonnes de la base. */
export function assertWritableCells(cells: Record<string, unknown>, types: Record<string, string>): void {
  for (const columnId of Object.keys(cells)) {
    const type = types[columnId];
    if (type === undefined) {
      throw new ProposalPlanError("invalid_cells", `Colonne inconnue : ${columnId}`);
    }
    if (COMPUTED_TYPES.has(type)) {
      throw new ProposalPlanError("invalid_cells", `La colonne ${columnId} est calculée (${type}) : écriture impossible`);
    }
    if (UNSUPPORTED_TYPES.has(type)) {
      throw new ProposalPlanError(
        "invalid_cells",
        `La colonne ${columnId} (${type}) ne peut pas être renseignée par l'assistant`,
      );
    }
  }
}

export function loadTypes(databaseId: string): Promise<Record<string, string>> {
  return loadColumnTypes(databaseId);
}

export function finishPlan(payload: ProposalPayload, freshness: Freshness): ProposalPlan {
  const { summary, rowCount } = summarizeProposal({ payload });
  return { payload, freshness, summary, rowCount };
}
