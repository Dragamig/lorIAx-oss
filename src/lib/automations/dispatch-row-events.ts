import { dispatchTrigger, dispatchValueChanged } from "./executor";

type Cells = Record<string, unknown>;

/**
 * Sends the automation events of one row write (created, updated + value_changed,
 * deleted). Fire-and-forget: call it after the write transaction, never from the
 * write helpers themselves (they emit no automation, see row-writes.ts).
 */
export function dispatchRowEvents(input: {
  databaseId: string;
  rowId: string;
  before: Cells | null;
  after: Cells | null;
}): void {
  const { databaseId, rowId, before, after } = input;
  if (after && !before) {
    void dispatchTrigger("row_created", { databaseId, rowId, cells: after });
  } else if (after && before) {
    void dispatchTrigger("row_updated", { databaseId, rowId, cells: after });
    void dispatchValueChanged({ databaseId, rowId, before, after });
  } else if (before) {
    void dispatchTrigger("row_deleted", { databaseId, rowId, cells: before });
  }
}
