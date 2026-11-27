import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";

type Cells = Record<string, unknown>;

/** Événement de ligne d'une écriture de proposition (même forme que le dispatch des routes de lignes). */
export type RowEvent = { databaseId: string; rowId: string; before: Cells | null; after: Cells | null };

/**
 * Une écriture appliquée au clic se comporte comme la même modification manuelle : les automatismes se
 * déclenchent. À appeler APRÈS le commit de la transaction. Le dispatch est « fire and forget » : une erreur
 * d'automatisme ne remet jamais en cause une écriture déjà validée.
 */
export function dispatchProposalRowEvents(events: RowEvent[]): void {
  for (const e of events) {
    try {
      dispatchRowEvents(e);
    } catch (err) {
      console.error("[ai-proposals] dispatch d'automatisme impossible", err);
    }
  }
}

/** Avant complet d'une ligne mise à jour : état verrouillé lu avant écriture, sinon reconstruit depuis l'après et les colonnes touchées. */
export function beforeOf(known: Cells | undefined, after: Cells, touchedBefore: Cells): Cells {
  return known ?? { ...after, ...touchedBefore };
}
