import { sql } from "drizzle-orm";
import { activityLog } from "@/lib/db/schema";
import type { DbExecutor } from "@/lib/databases/row-writes";
import type { RowHistoryItem } from "@/lib/databases/row-history-types";
import type { RowChangeEntry, RowChangeSource } from "@/lib/db/schema-row-activity";

export class InvalidHistoryCursorError extends Error {
  constructor() {
    super("Invalid history cursor");
    this.name = "InvalidHistoryCursorError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** TS_RE only checks the shape: reject impossible dates (month 13, Feb 31) before SQL casts them. */
function isRealTimestamp(t: string): boolean {
  const d = new Date(t.slice(0, 23) + "Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 23) === t.slice(0, 23);
}

/** The timestamp stays SQL text with microseconds: a JS Date would lose them. */
export function encodeHistoryCursor(t: string, i: string): string {
  return Buffer.from(JSON.stringify({ t, i }), "utf8").toString("base64url");
}

export function decodeHistoryCursor(cursor: string): { t: string; i: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed.t === "string" &&
      typeof parsed.i === "string" &&
      TS_RE.test(parsed.t) &&
      UUID_RE.test(parsed.i) &&
      isRealTimestamp(parsed.t)
    ) {
      return { t: parsed.t, i: parsed.i };
    }
  } catch {
    // falls through
  }
  throw new InvalidHistoryCursorError();
}

type RawRow = {
  id: string;
  kind: RowHistoryItem["kind"];
  source: RowChangeSource;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_label: string | null;
  automation_id: string | null;
  batch_id: string;
  changes: RowChangeEntry[];
  created_at_text: string;
};

const TS_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;

export async function listRowHistory(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string; orgId: string; cursor?: string; limit: number }
): Promise<{ items: RowHistoryItem[]; nextCursor: string | null }> {
  const { databaseId, rowId, orgId, limit } = args;
  const cur = args.cursor ? decodeHistoryCursor(args.cursor) : null;
  const cursorCond = cur
    ? sql`and (c.created_at, c.id) < (${cur.t}::timestamptz, ${cur.i}::uuid)`
    : sql``;

  const result = await executor.execute(sql`
    select c.id, c.kind, c.source, c.actor_user_id, u.name as actor_name, c.actor_label,
           c.automation_id, c.batch_id, c.changes,
           to_char(c.created_at at time zone 'UTC', ${TS_FORMAT}::text) as created_at_text
    from database_row_changes c
    left join organization_members om
      on om.user_id = c.actor_user_id and om.organization_id = ${orgId}::uuid
    left join users u on u.id = om.user_id
    where c.database_id = ${databaseId}::uuid
      and c.row_id = ${rowId}::uuid
      and exists (
        select 1 from user_databases d
        join spaces s on s.id = d.space_id
        where d.id = c.database_id and s.organization_id = ${orgId}::uuid
      )
      ${cursorCond}
    order by c.created_at desc, c.id desc
    limit ${limit + 1}
  `);

  const rows = result.rows as RawRow[];
  const page = rows.slice(0, limit);
  const items: RowHistoryItem[] = page.map((r) => ({
    id: r.id,
    kind: r.kind,
    source: r.source,
    actor: r.actor_user_id && r.actor_name !== null ? { id: r.actor_user_id, name: r.actor_name } : null,
    actorLabel: r.actor_label,
    automationId: r.automation_id,
    batchId: r.batch_id,
    changes: r.changes,
    createdAt: r.created_at_text,
  }));
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeHistoryCursor(last.created_at_text, last.id) : null;
  return { items, nextCursor };
}

/**
 * GDPR erasure of a row's history, comments (soft-deleted included), linked tasks and their
 * events, whether the row still exists or not. One transaction: everything and the audit
 * trail succeed or fail together. Row notifications are removed too (a task assignment
 * carries the task title). The audit entry holds ids and counts only, never text.
 * document_row_refs (lot 5) will be erased here too once they exist.
 */
export async function eraseRowHistory(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string; userId: string }
): Promise<{ erased: number; comments: number; tasks: number; taskEvents: number }> {
  const { databaseId, rowId, userId } = args;
  return executor.transaction(async (tx) => {
    const events = await tx.execute(sql`
      delete from database_row_task_events
      where database_id = ${databaseId}::uuid and row_id = ${rowId}::uuid
    `);
    const tasksRes = await tx.execute(sql`
      delete from tasks
      where kind = 'database_row' and database_id = ${databaseId}::uuid and row_id = ${rowId}::uuid
    `);
    const commentsRes = await tx.execute(sql`
      delete from database_row_comments
      where database_id = ${databaseId}::uuid and row_id = ${rowId}::uuid
    `);
    await tx.execute(sql`
      delete from notifications
      where database_id = ${databaseId}::uuid and row_id = ${rowId}::uuid
    `);
    const result = await tx.execute(sql`
      delete from database_row_changes
      where database_id = ${databaseId}::uuid and row_id = ${rowId}::uuid
    `);
    const erased = result.rowCount ?? 0;
    const comments = commentsRes.rowCount ?? 0;
    const tasks = tasksRes.rowCount ?? 0;
    const taskEvents = events.rowCount ?? 0;
    await tx.insert(activityLog).values({
      userId,
      action: "row_history.erased",
      entityType: "database_row",
      entityId: rowId,
      metadata: { databaseId, erased, comments, tasks, taskEvents },
    });
    return { erased, comments, tasks, taskEvents };
  });
}
