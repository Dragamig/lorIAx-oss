/**
 * B123, archivage gardé de attachments, studio_images et de leurs déclencheurs de synchronisation.
 *
 * ORDRE IMPÉRATIF dans init-db : cette étape s'exécute AVANT `drizzle-kit push --force`, car le push
 * détruit sans garde toute table de `public` absente de `schema.ts`. Les deux tables sont donc déplacées
 * dans le schéma `legacy_archive` (hors de portée de drizzle-kit, voir `schemaFilter` de
 * `drizzle.config.ts`) au lieu d'être supprimées : le retrait définitif est un lot ultérieur.
 *
 * Pont de mise à jour 1.21.x : une base publique 1.21.x n'a pas de table `media` et peut porter des lignes
 * `attachments`. Ces lignes sont copiées vers `media` avec la correspondance de 0052_mediatheque.sql
 * (identifiants, clés, types, tailles, auteurs, dates et liens de document conservés). Si `media` existe,
 * aucune copie : la garde d'intégrité ci-dessous s'applique seule et ne ressuscite pas les médias purgés ;
 * sinon les tables sont archivées d'abord (aucune donnée perdue) et `importArchivedMedia`, appelée par init-db après `drizzle-kit push` qui crée `media`,
 * termine la copie. Un commentaire sur chaque table archivée marque l'import à faire puis fait : une archive
 * plus ancienne n'est jamais réimportée, et une relance ne copie rien deux fois.
 *
 * Elle contrôle ensuite l'intégrité de la copie vers `media` (décision 4) : une seule orpheline
 * inaccessible d'attachments lève une erreur avant tout déplacement, le déploiement échoue et l'ancienne
 * image continue de servir. Une ligne studio_images sans média de même id n'est pas bloquante (la route
 * studio ne sert que `media`, elle est déjà inaccessible) : elle est comptée dans le rapport. Tout se
 * passe dans une transaction, sous un verrou consultatif de migration, un délai d'attente de verrou et un
 * verrou exclusif sur les deux tables.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import type { ModuleId } from "../src/lib/modules/types";
import { INCLUDED_MODULE_IDS } from "../src/lib/modules/registry.generated";
import { LEGACY_KEY_COLUMN, idMatchSql, keyMatchSql, keyOtherOrgSql, orphanSql, type LegacyKind } from "./media/lib/copy-integrity";

export interface RetireReport {
  attachmentsSeen: number;
  attachmentsCopied: number;
  /** Lignes sans média de même id mais dont la clé existe sur un média de la même organisation. */
  attachmentsDuplicates: number;
  /** Lignes sans média de même id dont la clé n'existe que dans une autre organisation (non bloquant). */
  attachmentsOtherOrgKey: number;
  /** Lignes copiées vers media par cette exécution (pont de mise à jour), 0 si media était déjà à jour. */
  attachmentsImported: number;
  studioSeen: number;
  studioCopied: number;
  studioImported: number;
  /** Lignes studio_images sans média de même id : déjà inaccessibles, archivées sans blocage. */
  studioOrphansIgnored: number;
  tablesArchived: string[];
  functionsDropped: string[];
}

/** Verrou consultatif de migration du retrait (constante arbitraire propre à cette étape). */
const LOCK_KEY = 5501055;
/** Schéma d'archive par défaut, aussi écrit en dur dans 0055_retire_attachments.sql. */
export const ARCHIVE_SCHEMA = "legacy_archive";
const LOCK_TIMEOUT = "30s";
const TABLES = ["attachments", "studio_images"] as const;

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [name]);
  return rows[0].present === true;
}

async function functionExists(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = $1 AND pg_function_is_visible(oid)) AS present",
    [name],
  );
  return rows[0].present === true;
}

const IMPORTED_MARK = "imported-to-media";
const PENDING_MARK = "pending-import-to-media";

/** Même table de correspondance MIME vers kind que 0052_mediatheque.sql et kindFromMime. */
const KIND_SQL = (col: string) => `(CASE
    WHEN ${col} ILIKE 'image/%' THEN 'image'
    WHEN ${col} ILIKE 'application/pdf' THEN 'pdf'
    WHEN ${col} ILIKE 'video/%' THEN 'video'
    WHEN ${col} ILIKE 'audio/%' THEN 'audio'
    WHEN ${col} ILIKE ANY (ARRAY['application/zip', 'application/x-tar', 'application/gzip', 'application/x-gzip']) THEN 'archive'
    WHEN ${col} ILIKE ANY (ARRAY['text/%', 'application/msword', 'application/rtf', 'application/json',
      'application/vnd.ms-%', 'application/vnd.openxmlformats-%', 'application/vnd.oasis.opendocument.%']) THEN 'document'
    ELSE 'other'
  END)::media_kind`;

/** Copie les lignes de `from.attachments` / `from.studio_images` absentes de media (idempotent, ON CONFLICT DO NOTHING). */
async function copyToMedia(
  client: PoolClient,
  tables: { attachments?: string; studio_images?: string },
): Promise<{ attachments: number; studio: number }> {
  let attachments = 0;
  let studio = 0;
  if (tables.attachments) {
    const r = await client.query(
      `INSERT INTO media (id, organization_id, space_id, document_id, filename, mime_type, kind, origin,
                          size_bytes, storage_key, uploaded_by, created_at, updated_at)
       SELECT a.id, s.organization_id, a.space_id, a.document_id, a.filename, a.mime_type, ${KIND_SQL("a.mime_type")},
              'upload'::media_origin, a.size_bytes, a.storage_key, a.uploaded_by, a.created_at, a.created_at
         FROM ${tables.attachments} a JOIN spaces s ON s.id = a.space_id
       ON CONFLICT DO NOTHING`,
    );
    attachments = r.rowCount ?? 0;
  }
  if (tables.studio_images) {
    const r = await client.query(
      `INSERT INTO media (id, organization_id, space_id, filename, mime_type, kind, origin,
                          size_bytes, storage_key, uploaded_by, created_at, updated_at)
       SELECT si.id, si.organization_id, si.space_id, si.name, si.content_type, 'image'::media_kind,
              'studio'::media_origin, COALESCE(si.size_bytes, 0), si.s3_key, si.created_by, si.created_at, si.updated_at
         FROM ${tables.studio_images} si
       ON CONFLICT DO NOTHING`,
    );
    studio = r.rowCount ?? 0;
  }
  return { attachments, studio };
}

/**
 * Seconde phase du pont de mise à jour, à appeler APRÈS `drizzle-kit push` : copie vers media les lignes des
 * tables archivées lorsque media n'existait pas au moment de l'archivage. Idempotente (marque posée sur la
 * table archivée, ON CONFLICT DO NOTHING) et transactionnelle.
 */
export async function importArchivedMedia(
  connectionString = process.env.DATABASE_URL,
  options: { archiveSchema?: string } = {},
): Promise<{ attachments: number; studio: number } | null> {
  const archive = options.archiveSchema ?? ARCHIVE_SCHEMA;
  if (!/^[a-z_][a-z0-9_]*$/.test(archive)) throw new Error(`Nom de schéma d'archive invalide : ${archive}`);
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
      if (!(await tableExists(client, "media"))) {
        await client.query("ROLLBACK");
        return null;
      }
      const todo: { attachments?: string; studio_images?: string } = {};
      const marked: string[] = [];
      for (const t of TABLES) {
        const full = `${archive}.${t}`;
        if (!(await tableExists(client, full))) continue;
        const { rows } = await client.query("SELECT obj_description(to_regclass($1), 'pg_class') AS c", [full]);
        if (rows[0].c !== PENDING_MARK) continue;
        todo[t] = full;
        marked.push(full);
      }
      if (marked.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const copied = await copyToMedia(client, todo);
      // Couverture : lignes vues dans l'archive contre lignes copiées. Une ligne ignorée (organisation
      // introuvable, conflit de clé) reste archivée : la marque est posée, mais l'écart est écrit au journal.
      const gaps: string[] = [];
      for (const t of TABLES) {
        const full = todo[t];
        if (!full) continue;
        const { rows } = await client.query(
          `SELECT count(*)::int AS seen,
                  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.id = t.id))::int AS skipped,
                  (array_agg(t.id::text) FILTER (WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.id = t.id)))[1:20] AS ids
             FROM ${full} t`,
        );
        const r = rows[0] as { seen: number; skipped: number; ids: string[] | null };
        const done = copied[t === "attachments" ? "attachments" : "studio"];
        console.log(`  ${t} : ${r.seen} lignes vues, ${done} copiées vers media, ${r.skipped} sans copie`);
        if (r.skipped > 0) gaps.push(`${t} : ${r.skipped} ligne(s) non copiée(s), restée(s) dans ${archive}.${t} (identifiants : ${(r.ids ?? []).join(", ")}${r.skipped > 20 ? ", ..." : ""})`);
      }
      for (const full of marked) await client.query(`COMMENT ON TABLE ${full} IS '${IMPORTED_MARK}'`);
      await client.query("COMMIT");
      console.log(`✓ Pièces jointes 1.21.x importées dans media : ${copied.attachments} attachments, ${copied.studio} studio_images`);
      for (const g of gaps) console.warn(`⚠ Écart d'import, ${g}`);
      return copied;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function measure(client: PoolClient, kind: LegacyKind) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS seen,
            count(*) FILTER (WHERE ${idMatchSql("t")})::int AS by_id,
            count(*) FILTER (WHERE NOT ${idMatchSql("t")} AND ${keyMatchSql(kind, "t")})::int AS by_key,
            count(*) FILTER (WHERE NOT ${idMatchSql("t")} AND ${keyOtherOrgSql(kind, "t")})::int AS by_key_other_org,
            count(*) FILTER (WHERE ${orphanSql(kind, "t")})::int AS orphans
       FROM ${kind} t`,
  );
  const r = rows[0] as { seen: number; by_id: number; by_key: number; by_key_other_org: number; orphans: number };
  let examples: string[] = [];
  if (r.orphans > 0) {
    const ex = await client.query(`SELECT t.id FROM ${kind} t WHERE ${orphanSql(kind, "t")} ORDER BY t.id LIMIT 3`);
    examples = ex.rows.map((x) => String(x.id));
  }
  return { ...r, examples, keyColumn: LEGACY_KEY_COLUMN[kind] };
}

export async function ensureAttachmentsRetired(
  connectionString = process.env.DATABASE_URL,
  options: { archiveSchema?: string; includedModuleIds?: readonly ModuleId[] } = {},
): Promise<RetireReport | null> {
  const archive = options.archiveSchema ?? ARCHIVE_SCHEMA;
  if (!/^[a-z_][a-z0-9_]*$/.test(archive)) throw new Error(`Nom de schéma d'archive invalide : ${archive}`);
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);

      const present: Record<string, boolean> = {};
      for (const t of TABLES) {
        present[t] = await tableExists(client, t);
        if (present[t] && (await tableExists(client, `${archive}.${t}`))) {
          throw new Error(
            `Archivage refusé : ${t} existe à la fois dans public et dans ${archive}. Résoudre à la main (comparer puis supprimer l'une des deux) avant de relancer.`,
          );
        }
      }
      if (!present.attachments && !present.studio_images) {
        // Base vide ou déjà archivée : rien à faire.
        await client.query("ROLLBACK");
        return null;
      }
      // Sans media (base d'avant 1.201, par exemple une 1.21.x publique), la copie est faite après
      // `drizzle-kit push` par importArchivedMedia : les tables sont archivées intactes d'ici là.
      const mediaPresent = await tableExists(client, "media");
      // Le pont sans table media est propre a l'edition oss. Avec le module commercial, la base vient
      // d'une version anterieure a 1.201 et l'archivage reste refuse, comme avant l'edition oss.
      if (!mediaPresent && (options.includedModuleIds ?? INCLUDED_MODULE_IDS).includes("commercial")) {
        throw new Error(
          "Archivage refusé : la table media est absente, la copie ne peut pas être vérifiée. Cette base vient d'une version antérieure à 1.201 : déployer d'abord une version 1.201 à 1.204, qui crée et remplit media, puis passer à cette version.",
        );
      }

      // Verrou exclusif avant toute mesure : plus d'écriture concurrente entre la garde et le déplacement.
      const toLock = TABLES.filter((t) => present[t]);
      await client.query(`LOCK TABLE ${toLock.join(", ")} IN ACCESS EXCLUSIVE MODE`);

      // Garde B123 d'abord, sans aucune copie préalable : quand media existe, une ligne attachments sans copie
      // accessible (média purgé) est une orpheline qui arrête le déploiement, jamais ressuscitée dans media.
      // Le pont 1.21.x ne passe que par importArchivedMedia (media absente à l'archivage).
      const att = present.attachments && mediaPresent ? await measure(client, "attachments") : null;
      const stu = present.studio_images && mediaPresent ? await measure(client, "studio_images") : null;
      if (att && att.orphans > 0) {
        throw new Error(
          `Archivage refusé : ${att.orphans} ligne(s) de attachments sans copie accessible dans media (exemples d'identifiants : ${att.examples.join(", ")}). Aucune table déplacée.`,
        );
      }

      const count = async (t: string) => Number((await client.query(`SELECT count(*) FROM ${t}`)).rows[0].count);
      const attSeen = present.attachments ? (att?.seen ?? (await count("attachments"))) : 0;
      const stuSeen = present.studio_images ? (stu?.seen ?? (await count("studio_images"))) : 0;

      const functionsDropped: string[] = [];
      for (const fn of ["media_sync_from_attachments", "media_sync_from_studio_images"]) {
        if (await functionExists(client, fn)) functionsDropped.push(fn);
      }
      const sql = readFileSync(
        join(__dirname, "..", "src", "lib", "db", "migrations", "0055_retire_attachments.sql"),
        "utf8",
      ).replace(/legacy_archive/g, archive);
      await client.query(sql);
      if (!mediaPresent) {
        // Seules les tables archivées sans media sont à importer : une archive plus ancienne ne l'est jamais.
        for (const t of toLock) await client.query(`COMMENT ON TABLE ${archive}.${t} IS '${PENDING_MARK}'`);
      }
      await client.query("COMMIT");

      const report: RetireReport = {
        attachmentsSeen: attSeen,
        attachmentsCopied: att ? att.by_id + att.by_key + att.by_key_other_org : 0,
        attachmentsImported: 0,
        attachmentsDuplicates: att?.by_key ?? 0,
        attachmentsOtherOrgKey: att?.by_key_other_org ?? 0,
        studioSeen: stuSeen,
        studioCopied: stu?.by_id ?? 0,
        studioImported: 0,
        studioOrphansIgnored: stu?.orphans ?? 0,
        tablesArchived: toLock,
        functionsDropped,
      };
      console.log(
        `✓ Archivage attachments : ${report.attachmentsCopied}/${report.attachmentsSeen} copiées (${report.attachmentsImported} importées vers media, ${report.attachmentsDuplicates} doublons, ${report.attachmentsOtherOrgKey} clés d'une autre organisation), studio ${report.studioCopied}/${report.studioSeen} (${report.studioOrphansIgnored} orphelines ignorées), tables archivées dans ${archive} : ${report.tablesArchived.join(", ")}`,
      );
      return report;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  ensureAttachmentsRetired().catch((e) => {
    console.error("Erreur retire-attachments :", e?.message ?? e);
    process.exit(1);
  });
}
