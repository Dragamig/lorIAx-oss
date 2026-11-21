import { sql } from "drizzle-orm";
import type { RowChangeSource } from "@/lib/db/schema-row-activity";
import type { DbExecutor } from "./row-writes";
import type { MediaGuardActor } from "./attachment-cell-guard";

/** Context read by the row history triggers (migration 0054) via `loriax.row_ctx`. */
export interface RowChangeContext {
  source: RowChangeSource;
  actorUserId?: string | null;
  actorLabel?: string | null;
  automationId?: string | null;
  batchId?: string;
  skip?: boolean;
  /** Si présent, les cellules écrites sont contrôlées (médias lisibles par cet acteur). Jamais sérialisé. */
  mediaGuard?: MediaGuardActor;
}

/** Context that suppresses history entries for the transaction. */
export const SKIP_ROW_HISTORY: RowChangeContext = { source: "system", skip: true };

/** Serializes the context, omitting absent (undefined) keys. */
export function serializeRowChangeContext(ctx: RowChangeContext): string {
  const { mediaGuard: _mediaGuard, ...persisted } = ctx;
  void _mediaGuard;
  return JSON.stringify(persisted);
}

/**
 * Sets the transaction-local row context (`set_config(..., true)`), so it is
 * discarded at commit or rollback and never leaks to the next transaction.
 */
export async function setRowChangeContext(tx: DbExecutor, ctx: RowChangeContext): Promise<void> {
  await tx.execute(sql`select set_config('loriax.row_ctx', ${serializeRowChangeContext(ctx)}, true)`);
}
