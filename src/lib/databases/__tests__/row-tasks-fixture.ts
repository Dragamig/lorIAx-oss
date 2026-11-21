/**
 * Fixture du lot 3 : etend celle de l'historique de ligne (schema rh_<suite>) avec tasks,
 * notifications, commentaires et evenements de tache. `preMigrated: false` s'arrete avant la
 * migration 0056 (task_kind sans database_row, sans nouvelles colonnes, tables ni index) pour que
 * les tests de migration puissent echouer.
 */
import { setupRowHistoryFixture } from "./row-history-fixture";

export async function setupRowTasksFixture(
  url: string,
  schemaName: string,
  opts: { preMigrated?: boolean } = {},
): Promise<Awaited<ReturnType<typeof setupRowHistoryFixture>>> {
  const preMigrated = opts.preMigrated ?? true;
  const f = await setupRowHistoryFixture(url, schemaName);
  await f.pool.query(`
    ALTER TABLE users ADD COLUMN email varchar(320);
    ALTER TABLE users ADD COLUMN avatar_url varchar(512);
    ALTER TABLE user_databases ADD COLUMN name varchar(255) NOT NULL DEFAULT '';
    CREATE TYPE task_kind AS ENUM ('document_item', 'gantt_event'${preMigrated ? ", 'database_row'" : ""});
    CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'done', 'cancelled');
    CREATE TYPE notification_type AS ENUM ('mention', 'comment', 'reply', 'share', 'calendar_reminder',
      'calendar_invitation', 'meeting_room_cancelled', 'chat_message', 'task_assigned', 'automation', 'media');
    CREATE TABLE tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind task_kind NOT NULL,
      title varchar(500) NOT NULL,
      status task_status NOT NULL DEFAULT 'open',
      due_at timestamptz,
      assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      document_id uuid,
      node_id varchar(100),
      calendar_event_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type notification_type NOT NULL,
      title varchar(500) NOT NULL,
      message text,
      document_id uuid,
      actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  if (preMigrated) {
    await f.pool.query(`
      ALTER TABLE tasks ADD COLUMN database_id uuid REFERENCES user_databases(id) ON DELETE CASCADE;
      ALTER TABLE tasks ADD COLUMN row_id uuid;
      ALTER TABLE tasks ADD CONSTRAINT tasks_database_row_ctx
        CHECK (kind <> 'database_row' OR (database_id IS NOT NULL AND row_id IS NOT NULL));
      ALTER TABLE notifications ADD COLUMN database_id uuid REFERENCES user_databases(id) ON DELETE CASCADE;
      ALTER TABLE notifications ADD COLUMN row_id uuid;
      CREATE TYPE row_task_event_kind AS ENUM ('created', 'completed', 'reopened');
      CREATE TABLE database_row_comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
        row_id uuid NOT NULL,
        author_id uuid REFERENCES users(id) ON DELETE SET NULL,
        body text NOT NULL,
        mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        edited_at timestamptz,
        deleted_at timestamptz);
      CREATE TABLE database_row_task_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
        row_id uuid NOT NULL,
        kind row_task_event_kind NOT NULL,
        actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX idx_tasks_database_row ON tasks (database_id, row_id);
      CREATE INDEX idx_row_comments_row ON database_row_comments (database_id, row_id, created_at DESC, id DESC);
      CREATE INDEX idx_row_comments_deleted ON database_row_comments (deleted_at) WHERE deleted_at IS NOT NULL;
      CREATE INDEX idx_row_task_events_row ON database_row_task_events (database_id, row_id, created_at DESC, id DESC);
      CREATE INDEX idx_row_task_events_task ON database_row_task_events (task_id);
    `);
  }
  return f;
}
