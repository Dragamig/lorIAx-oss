import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/databases/row-writes";
import { decodeHistoryCursor, encodeHistoryCursor } from "@/lib/databases/row-history-read";
import type { RowActivityItem } from "@/lib/databases/row-activity-types";

const TS_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;

type RawRow = {
  type: "change" | "comment" | "task_created" | "task_completed" | "task_reopened";
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  created_at_text: string;
};

/**
 * Merged timeline of a row: history, comments and task events. One UNION ALL, every branch
 * scoped by database_id AND row_id, total order (created_at desc, id desc) on the union.
 */
export async function listRowActivity(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string; orgId: string; cursor?: string; limit: number }
): Promise<{ items: RowActivityItem[]; nextCursor: string | null }> {
  const { databaseId, rowId, orgId, limit } = args;
  const cur = args.cursor ? decodeHistoryCursor(args.cursor) : null;
  const cursorCond = cur
    ? sql`and (a.created_at, a.id) < (${cur.t}::timestamptz, ${cur.i}::uuid)`
    : sql``;

  const result = await executor.execute(sql`
    select a.type, a.id, a.actor_user_id, u.name as actor_name, a.payload,
           to_char(a.created_at at time zone 'UTC', ${TS_FORMAT}::text) as created_at_text
    from (
      select 'change'::text as type, c.id, c.created_at, c.actor_user_id,
             jsonb_build_object('kind', c.kind, 'source', c.source, 'actorLabel', c.actor_label,
               'automationId', c.automation_id, 'batchId', c.batch_id, 'changes', c.changes) as payload
      from database_row_changes c
      where c.database_id = ${databaseId}::uuid and c.row_id = ${rowId}::uuid
      union all
      select 'comment'::text, m.id, m.created_at, m.author_id,
             jsonb_build_object(
               'body', case when m.deleted_at is null then m.body end,
               'mentions', case when m.deleted_at is null then m.mentions else '[]'::jsonb end,
               'editedAt', to_char(m.edited_at at time zone 'UTC', ${TS_FORMAT}::text),
               'deleted', m.deleted_at is not null)
      from database_row_comments m
      where m.database_id = ${databaseId}::uuid and m.row_id = ${rowId}::uuid
      union all
      select 'task_' || e.kind::text, e.id, e.created_at, e.actor_user_id,
             jsonb_build_object('taskId', e.task_id, 'taskTitle', t.title)
      from database_row_task_events e
      left join tasks t on t.id = e.task_id
        and t.row_id = e.row_id and t.database_id = e.database_id
      where e.database_id = ${databaseId}::uuid and e.row_id = ${rowId}::uuid
    ) a
    left join organization_members om
      on om.user_id = a.actor_user_id and om.organization_id = ${orgId}::uuid
    left join users u on u.id = om.user_id
    where exists (
        select 1 from user_databases d
        join spaces s on s.id = d.space_id
        where d.id = ${databaseId}::uuid and s.organization_id = ${orgId}::uuid
      )
      ${cursorCond}
    order by a.created_at desc, a.id desc
    limit ${limit + 1}
  `);

  const rows = result.rows as RawRow[];
  const page = rows.slice(0, limit);
  const items: RowActivityItem[] = page.map((r) => {
    const actor =
      r.actor_user_id && r.actor_name !== null ? { id: r.actor_user_id, name: r.actor_name } : null;
    const p = r.payload as Record<string, never>;
    if (r.type === "change") {
      return {
        type: "change",
        id: r.id,
        kind: p.kind,
        source: p.source,
        actor,
        actorLabel: p.actorLabel ?? null,
        automationId: p.automationId ?? null,
        batchId: p.batchId,
        changes: p.changes,
        createdAt: r.created_at_text,
      };
    }
    if (r.type === "comment") {
      return {
        type: "comment",
        id: r.id,
        createdAt: r.created_at_text,
        actor,
        body: p.body ?? null,
        mentions: p.mentions,
        editedAt: p.editedAt ?? null,
        deleted: p.deleted,
      };
    }
    return {
      type: r.type,
      id: r.id,
      createdAt: r.created_at_text,
      actor,
      taskId: p.taskId,
      taskTitle: p.taskTitle ?? null,
    };
  });
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeHistoryCursor(last.created_at_text, last.id) : null;
  return { items, nextCursor };
}
