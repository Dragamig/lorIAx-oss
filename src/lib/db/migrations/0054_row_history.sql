-- Historique de ligne (lot 2) : fonctions PL/pgSQL et declencheurs sur user_database_rows.
-- La table database_row_changes et ses enums sont crees par `drizzle-kit push` depuis
-- src/lib/db/schema-row-activity.ts, pas par ce fichier. Idempotent.
-- Les tables sont resolues par le search_path de la session (aucun schema qualifie).

CREATE OR REPLACE FUNCTION row_history_is_empty(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(v) = 'string' THEN
    -- Same blank set as String.prototype.trim (btrim alone only strips ASCII space).
    RETURN (v #>> '{}') ~ '^[\t\n\v\f\r    -     　﻿]*$';
  END IF;
  IF jsonb_typeof(v) = 'array' THEN
    RETURN jsonb_array_length(v) = 0;
  END IF;
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION row_history_cap(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF v IS NULL THEN
    RETURN 'null'::jsonb;
  END IF;
  IF jsonb_typeof(v) = 'string' AND char_length(v #>> '{}') > 2000 THEN
    RETURN to_jsonb(left(v #>> '{}', 2000));
  END IF;
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION row_history_entry(
  p_key text, p_name text, p_type text, p_before jsonb, p_after jsonb
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  v_truncated boolean;
  v_entry jsonb;
BEGIN
  v_truncated :=
    (p_before IS NOT NULL AND jsonb_typeof(p_before) = 'string' AND char_length(p_before #>> '{}') > 2000)
    OR (p_after IS NOT NULL AND jsonb_typeof(p_after) = 'string' AND char_length(p_after #>> '{}') > 2000);
  v_entry := jsonb_build_object(
    'columnId', p_key,
    'columnName', coalesce(p_name, ''),
    'columnType', coalesce(p_type, 'text'),
    'before', row_history_cap(p_before),
    'after', row_history_cap(p_after)
  );
  IF v_truncated THEN
    v_entry := v_entry || '{"truncated": true}'::jsonb;
  END IF;
  RETURN v_entry;
END;
$fn$;

CREATE OR REPLACE FUNCTION row_changes_capture() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_raw text;
  v_ctx jsonb;
  v_skip boolean := false;
  v_source row_change_source;
  v_actor uuid;
  v_label text;
  v_automation uuid;
  v_batch uuid;
  v_changes jsonb;
  v_kind row_change_kind;
  v_row_id uuid;
  v_db_id uuid;
BEGIN
  v_raw := current_setting('loriax.row_ctx', true);
  BEGIN
    v_ctx := NULLIF(v_raw, '')::jsonb;
  EXCEPTION WHEN others THEN
    v_ctx := NULL;
  END;
  IF v_ctx IS NOT NULL AND jsonb_typeof(v_ctx) <> 'object' THEN
    v_ctx := NULL;
  END IF;

  IF v_ctx IS NOT NULL THEN
    BEGIN
      v_skip := coalesce((v_ctx ->> 'skip')::boolean, false);
    EXCEPTION WHEN others THEN
      v_skip := false;
    END;
    IF v_skip THEN
      RETURN NULL;
    END IF;
    BEGIN
      v_source := (v_ctx ->> 'source')::row_change_source;
    EXCEPTION WHEN others THEN
      v_source := NULL;
    END;
    BEGIN
      v_actor := (v_ctx ->> 'actorUserId')::uuid;
    EXCEPTION WHEN others THEN
      v_actor := NULL;
    END;
    BEGIN
      v_automation := (v_ctx ->> 'automationId')::uuid;
    EXCEPTION WHEN others THEN
      v_automation := NULL;
    END;
    BEGIN
      v_batch := (v_ctx ->> 'batchId')::uuid;
    EXCEPTION WHEN others THEN
      v_batch := NULL;
    END;
    v_label := left(v_ctx ->> 'actorLabel', 120);
  END IF;

  v_source := coalesce(v_source, 'system');
  v_batch := coalesce(v_batch, md5('row-tx:' || txid_current()::text)::uuid);
  -- A dangling actor id must not fail the row write through the foreign key.
  IF v_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_actor) THEN
    v_actor := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_kind := 'created';
    v_row_id := NEW.id;
    v_db_id := NEW.database_id;
    IF v_source = 'import' THEN
      v_changes := '[]'::jsonb;
    ELSE
      SELECT coalesce(jsonb_agg(row_history_entry(e.key, c.name, c.type::text, NULL, e.value) ORDER BY c.position NULLS LAST, e.key), '[]'::jsonb)
        INTO v_changes
        FROM jsonb_each(NEW.cells) e
        LEFT JOIN user_database_columns c ON c.id::text = e.key AND c.database_id = NEW.database_id
       WHERE NOT row_history_is_empty(e.value);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM user_databases WHERE id = OLD.database_id) THEN
      RETURN NULL;
    END IF;
    v_kind := 'deleted';
    v_row_id := OLD.id;
    v_db_id := OLD.database_id;
    SELECT coalesce(jsonb_agg(row_history_entry(e.key, c.name, c.type::text, e.value, NULL) ORDER BY c.position NULLS LAST, e.key), '[]'::jsonb)
      INTO v_changes
      FROM jsonb_each(OLD.cells) e
      LEFT JOIN user_database_columns c ON c.id::text = e.key AND c.database_id = OLD.database_id;
  ELSE
    v_kind := 'updated';
    v_row_id := NEW.id;
    v_db_id := NEW.database_id;
    SELECT coalesce(jsonb_agg(row_history_entry(k.key, c.name, c.type::text, OLD.cells -> k.key, NEW.cells -> k.key) ORDER BY c.position, k.key), '[]'::jsonb)
      INTO v_changes
      FROM (
        SELECT jsonb_object_keys(OLD.cells) AS key
        UNION
        SELECT jsonb_object_keys(NEW.cells) AS key
      ) k
      JOIN user_database_columns c ON c.id::text = k.key AND c.database_id = NEW.database_id
     WHERE c.type::text NOT IN ('formula', 'autonumber')
       AND coalesce(OLD.cells -> k.key, 'null'::jsonb) IS DISTINCT FROM coalesce(NEW.cells -> k.key, 'null'::jsonb);
    IF v_changes = '[]'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO database_row_changes
    (database_id, row_id, kind, source, actor_user_id, actor_label, automation_id, batch_id, changes)
  VALUES
    (v_db_id, v_row_id, v_kind, v_source, v_actor, v_label, v_automation, v_batch, v_changes);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_row_history_insert ON user_database_rows;
CREATE TRIGGER trg_row_history_insert
  AFTER INSERT ON user_database_rows
  FOR EACH ROW EXECUTE FUNCTION row_changes_capture();

DROP TRIGGER IF EXISTS trg_row_history_update ON user_database_rows;
CREATE TRIGGER trg_row_history_update
  AFTER UPDATE ON user_database_rows
  FOR EACH ROW WHEN (OLD.cells IS DISTINCT FROM NEW.cells)
  EXECUTE FUNCTION row_changes_capture();

DROP TRIGGER IF EXISTS trg_row_history_delete ON user_database_rows;
CREATE TRIGGER trg_row_history_delete
  AFTER DELETE ON user_database_rows
  FOR EACH ROW EXECUTE FUNCTION row_changes_capture();
