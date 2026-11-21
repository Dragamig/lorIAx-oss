import type { tallyImports } from "@/lib/db/schema";

type ImportRow = typeof tallyImports.$inferSelect;

/** Vue publique d'un import : compteurs et état, rien d'autre. */
export function publicImport(r: ImportRow) {
  return {
    id: r.id,
    automationId: r.automationId,
    formId: r.formId,
    mode: r.mode,
    status: r.status,
    since: r.since,
    cap: r.cap,
    total: r.total,
    processed: r.processed,
    created: r.created,
    completed: r.completed,
    ignored: r.ignored,
    errors: r.errors,
    skipped: r.skipped,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
