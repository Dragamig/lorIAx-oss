/**
 * B123, archivage gardé de attachments, studio_images et de leurs déclencheurs de synchronisation.
 *
 * ORDRE IMPÉRATIF dans init-db : cette étape s'exécute AVANT `drizzle-kit push --force`, car le push
 * détruit sans garde toute table de `public` absente de `schema.ts`. Les deux tables sont donc déplacées
 * dans le schéma `legacy_archive` (hors de portée de drizzle-kit, voir `schemaFilter` de
 * `drizzle.config.ts`) au lieu d'être supprimées : le retrait définitif est un lot ultérieur.
 *
 * Elle contrôle d'abord l'intégrité de la copie vers `media` (décision 4) : une seule orpheline
 * inaccessible d'attachments lève une erreur avant tout déplacement, le déploiement échoue et l'ancienne
 * image continue de servir. Une ligne studio_images sans média de même id n'est pas bloquante (la route
 * studio ne sert que `media`, elle est déjà inaccessible) : elle est comptée dans le rapport. Tout se
 * passe dans une transaction, sous un verrou consultatif de migration, un délai d'attente de verrou et un
 * verrou exclusif sur les deux tables.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { LEGACY_KEY_COLUMN, idMatchSql, keyMatchSql, keyOtherOrgSql, orphanSql, type LegacyKind } from "./media/lib/copy-integrity";

export interface RetireReport {
  attachmentsSeen: number;
  attachmentsCopied: number;
  /** Lignes sans média de même id mais dont la clé existe sur un média de la même organisation. */
  attachmentsDuplicates: number;
  /** Lignes sans média de même id dont la clé n'existe que dans une autre organisation (non bloquant). */
  attachmentsOtherOrgKey: number;
  studioSeen: number;
  studioCopied: number;
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
  options: { archiveSchema?: string } = {},
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
      if (!(await tableExists(client, "media"))) {
        throw new Error(
          "Archivage refusé : la table media est absente, la copie ne peut pas être vérifiée. Cette base vient d'une version antérieure à 1.201 : déployer d'abord une version 1.201 à 1.204, qui crée et remplit media, puis passer à cette version.",
        );
      }

      // Verrou exclusif avant toute mesure : plus d'écriture concurrente entre la garde et le déplacement.
      const toLock = TABLES.filter((t) => present[t]);
      await client.query(`LOCK TABLE ${toLock.join(", ")} IN ACCESS EXCLUSIVE MODE`);

      const att = present.attachments ? await measure(client, "attachments") : null;
      const stu = present.studio_images ? await measure(client, "studio_images") : null;
      if (att && att.orphans > 0) {
        throw new Error(
          `Archivage refusé : ${att.orphans} ligne(s) de attachments sans copie accessible dans media (exemples d'identifiants : ${att.examples.join(", ")}). Aucune table déplacée.`,
        );
      }

      const functionsDropped: string[] = [];
      for (const fn of ["media_sync_from_attachments", "media_sync_from_studio_images"]) {
        if (await functionExists(client, fn)) functionsDropped.push(fn);
      }
      const sql = readFileSync(
        join(__dirname, "..", "src", "lib", "db", "migrations", "0055_retire_attachments.sql"),
        "utf8",
      ).replace(/legacy_archive/g, archive);
      await client.query(sql);
      await client.query("COMMIT");

      const report: RetireReport = {
        attachmentsSeen: att?.seen ?? 0,
        attachmentsCopied: att ? att.by_id + att.by_key + att.by_key_other_org : 0,
        attachmentsDuplicates: att?.by_key ?? 0,
        attachmentsOtherOrgKey: att?.by_key_other_org ?? 0,
        studioSeen: stu?.seen ?? 0,
        studioCopied: stu?.by_id ?? 0,
        studioOrphansIgnored: stu?.orphans ?? 0,
        tablesArchived: toLock,
        functionsDropped,
      };
      console.log(
        `✓ Archivage attachments : ${report.attachmentsCopied}/${report.attachmentsSeen} copiées (${report.attachmentsDuplicates} doublons, ${report.attachmentsOtherOrgKey} clés d'une autre organisation), studio ${report.studioCopied}/${report.studioSeen} (${report.studioOrphansIgnored} orphelines ignorées), tables archivées dans ${archive} : ${report.tablesArchived.join(", ")}`,
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
