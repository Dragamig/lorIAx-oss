-- Commentaires et taches de ligne (lot 3). `drizzle-kit push` cree deja les tables
-- database_row_comments et database_row_task_events, l'enum row_task_event_kind, les colonnes
-- database_id et row_id de tasks et notifications, ainsi que leurs index. Ce fichier consigne
-- l'equivalent idempotent, execute par scripts/migrate-row-comments.ts.
-- La valeur d'enum `ALTER TYPE task_kind ADD VALUE 'database_row'` est jouee a part par le script
-- (hors transaction) et n'est donc pas dans ce fichier.
-- Les tables sont resolues par le search_path de la session (aucun schema qualifie).

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS database_id uuid REFERENCES user_databases(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS row_id uuid;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS database_id uuid REFERENCES user_databases(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS row_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'row_task_event_kind'
                 AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    CREATE TYPE row_task_event_kind AS ENUM ('created', 'completed', 'reopened');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS database_row_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
  row_id uuid NOT NULL,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS database_row_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
  row_id uuid NOT NULL,
  kind row_task_event_kind NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_database_row ON tasks (database_id, row_id);
CREATE INDEX IF NOT EXISTS idx_row_comments_row ON database_row_comments (database_id, row_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_row_comments_deleted ON database_row_comments (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_row_task_events_row ON database_row_task_events (database_id, row_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_row_task_events_task ON database_row_task_events (task_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_database_row_ctx'
                 AND conrelid = 'tasks'::regclass) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_database_row_ctx
      CHECK (kind <> 'database_row' OR (database_id IS NOT NULL AND row_id IS NOT NULL));
  END IF;
END
$$;
