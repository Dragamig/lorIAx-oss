-- B123, archivage des anciennes tables de la médiathèque : attachments et studio_images.
-- Exécutée par scripts/retire-attachments.ts (init-db), dans la transaction de la garde d'intégrité,
-- AVANT drizzle-kit push. Les tables ne sont pas supprimées : elles sont déplacées dans le schéma
-- legacy_archive (le nom est substitué par le script, qui le valide), que drizzle-kit ne gère pas.
-- Tolérante à l'absence de l'une ou l'autre table.
CREATE SCHEMA IF NOT EXISTS legacy_archive;
DROP TRIGGER IF EXISTS trg_attachments_to_media ON attachments;
DROP TRIGGER IF EXISTS trg_studio_images_to_media ON studio_images;
DROP FUNCTION IF EXISTS media_sync_from_attachments();
DROP FUNCTION IF EXISTS media_sync_from_studio_images();
-- Les clés étrangères sortantes sont retirées : une table archivée ne doit ni bloquer la suppression
-- d'un utilisateur (NO ACTION vers users), ni voir ses lignes effacées en cascade par un autre module.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
     WHERE contype = 'f' AND conrelid IN (to_regclass('attachments'), to_regclass('studio_images'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;
ALTER TABLE IF EXISTS attachments SET SCHEMA legacy_archive;
ALTER TABLE IF EXISTS studio_images SET SCHEMA legacy_archive;
