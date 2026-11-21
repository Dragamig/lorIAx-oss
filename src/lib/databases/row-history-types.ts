import type { RowChangeEntry, RowChangeSource } from "@/lib/db/schema-row-activity";

export type RowHistoryItem = {
  id: string;
  kind: "created" | "updated" | "deleted";
  source: RowChangeSource;
  actor: { id: string; name: string } | null;
  actorLabel: string | null;
  automationId: string | null;
  batchId: string;
  changes: RowChangeEntry[];
  createdAt: string;
};

export type RowHistoryPage = {
  items: RowHistoryItem[];
  nextCursor: string | null;
  /** True only for organization admins and owners (clearing is admin-only). */
  canClear: boolean;
};
