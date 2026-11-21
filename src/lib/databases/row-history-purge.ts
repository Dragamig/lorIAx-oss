import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import type { DbExecutor } from "@/lib/databases/row-writes";

const DEFAULT_BATCH = 500;
const RETENTION_DAYS = 30;

/**
 * Purges the history of deleted rows: every entry of a (database_id, row_id) pair whose
 * latest `deleted` entry is older than 30 days AND whose row no longer exists in
 * `user_database_rows` (a restored row re-uses its id and keeps everything). For the same
 * pairs it also removes the row comments, the linked `database_row` tasks, their events and
 * the row notifications (the task title travels in them). Comments soft-deleted more than
 * 30 days ago are purged too, row existing or not.
 * Batched, one transaction per batch, guarded by an advisory lock. Idempotent; lets
 * database errors propagate (the cron route answers 500, the scheduled job logs them).
 */
export async function purgeDeletedRowHistory(
  executor: DbExecutor = db,
  opts: { batchSize?: number } = {}
): Promise<{ purged: number; comments: number; tasks: number; taskEvents: number }> {
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? DEFAULT_BATCH));
  const total = { purged: 0, comments: 0, tasks: 0, taskEvents: 0 };
  for (;;) {
    const batch = await executor.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended('row-history-purge', 0)) as locked`
      );
      if (!(lock.rows[0] as { locked: boolean }).locked) return null;
      const res = await tx.execute(sql`
        with pairs as (
          select c.database_id, c.row_id
          from database_row_changes c
          where c.kind = 'deleted'
          group by c.database_id, c.row_id
          having max(c.created_at) < now() - make_interval(days => ${RETENTION_DAYS})
            and not exists (select 1 from user_database_rows r where r.id = c.row_id)
          limit ${batchSize}
        ),
        del_events as (
          delete from database_row_task_events e
          using pairs p
          where e.database_id = p.database_id and e.row_id = p.row_id
          returning 1
        ),
        del_tasks as (
          delete from tasks t
          using pairs p
          where t.kind = 'database_row' and t.database_id = p.database_id and t.row_id = p.row_id
          returning 1
        ),
        del_notifs as (
          delete from notifications n
          using pairs p
          where n.database_id = p.database_id and n.row_id = p.row_id
          returning 1
        ),
        del_pair_comments as (
          delete from database_row_comments m
          using pairs p
          where m.database_id = p.database_id and m.row_id = p.row_id
          returning 1
        ),
        old_comments as (
          select id from database_row_comments
          where deleted_at is not null and deleted_at < now() - make_interval(days => ${RETENTION_DAYS})
          limit ${batchSize}
        ),
        del_old_comments as (
          delete from database_row_comments m
          using old_comments o
          where m.id = o.id
          returning 1
        ),
        del as (
          delete from database_row_changes d
          using pairs p
          where d.database_id = p.database_id and d.row_id = p.row_id
          returning 1
        )
        select
          (select count(*) from del)::int as history,
          (select count(*) from del_pair_comments)::int + (select count(*) from del_old_comments)::int as comments,
          (select count(*) from del_tasks)::int as tasks,
          (select count(*) from del_events)::int as events,
          (select count(*) from del_notifs)::int as notifs
      `);
      return res.rows[0] as { history: number; comments: number; tasks: number; events: number; notifs: number };
    });
    if (!batch) break;
    total.purged += batch.history;
    total.comments += batch.comments;
    total.tasks += batch.tasks;
    total.taskEvents += batch.events;
    // A batch can only produce notifications/tasks with a pair, so history or comments drive the loop.
    if (batch.history <= 0 && batch.comments <= 0) break;
  }
  return total;
}

export function isRowHistoryPurgeDisabled(): boolean {
  return process.env.ROW_HISTORY_PURGE === "off";
}

/** Safe wrapper for `server.ts`. */
export async function runRowHistoryPurgeJob(): Promise<void> {
  try {
    const res = await purgeDeletedRowHistory();
    if (res.purged > 0 || res.comments > 0) logger.info(res, "Purge de l'historique des lignes supprimées terminée");
  } catch (err) {
    logger.error({ err }, "Erreur de la purge planifiée de l'historique des lignes");
  }
}
