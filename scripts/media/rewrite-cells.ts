/**
 * B70 : réécrit les cellules image et pièces jointes des bases vers /api/media/<id> et { mediaId }.
 * --apply exige --confirm-db=<nom de la base cible> ; une base nommée `loriax` exige --confirm-db=loriax
 * même en simulation. --apply et --dry-run sont exclusifs et sans valeur.
 * Simulation par défaut ; --apply écrit après sauvegarde, par mise à jour conditionnelle.
 *   npm run media:rewrite-cells -- [--apply --confirm-db <base>] [--limit N] [--org <uuid>] [--report <fichier>]
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import {
  describeTarget,
  parseMode,
  requireDatabaseUrl,
  assertTargetAllowed,
  writeBackup,
  type LookupResult,
  type MediaLite,
  type RewriteMode,
} from "./lib/plan";
import { Report } from "./lib/report";
import { rewriteAttachmentCell, rewriteImageCell } from "./lib/rewrite-cell-values";

const BATCH_SIZE = 200;
const BACKUP_DIR = "tmp/media-rewrite";

interface ColumnInfo {
  id: string;
  type: "image" | "attachment";
}
interface DatabaseInfo {
  id: string;
  spaceId: string;
  organizationId: string;
  columns: ColumnInfo[];
}

function toLite(r: Record<string, unknown>): MediaLite {
  return {
    id: r.id as string,
    storageKey: r.storage_key as string,
    organizationId: r.organization_id as string,
    spaceId: (r.space_id as string | null) ?? null,
    filename: r.filename as string,
    mimeType: r.mime_type as string,
    sizeBytes: Number(r.size_bytes),
  };
}

async function loadDatabases(client: PoolClient, mode: RewriteMode): Promise<DatabaseInfo[]> {
  const params: unknown[] = [];
  let orgFilter = "";
  if (mode.org) {
    params.push(mode.org);
    orgFilter = "AND s.organization_id = $1";
  }
  const { rows } = await client.query(
    `SELECT d.id AS database_id, d.space_id, s.organization_id, c.id AS column_id, c.type
       FROM user_database_columns c
       JOIN user_databases d ON d.id = c.database_id
       JOIN spaces s ON s.id = d.space_id
      WHERE c.type IN ('image', 'attachment') ${orgFilter}
      ORDER BY d.id, c.position`,
    params
  );
  const byDb = new Map<string, DatabaseInfo>();
  for (const r of rows) {
    let db = byDb.get(r.database_id);
    if (!db) {
      db = { id: r.database_id, spaceId: r.space_id, organizationId: r.organization_id, columns: [] };
      byDb.set(r.database_id, db);
    }
    db.columns.push({ id: r.column_id, type: r.type });
  }
  return [...byDb.values()];
}

/**
 * Médias non supprimés lisibles depuis l'espace de la base : même espace, ou espace
 * d'organisation non secret (lisible par tout membre, comme `isOrgWideSpace`). Un média
 * sans espace (lisible de son seul auteur et des admins) n'est jamais retenu.
 */
async function mediaByKeys(
  client: PoolClient,
  orgId: string,
  spaceId: string,
  keys: string[]
): Promise<Map<string, MediaLite[]>> {
  const out = new Map<string, MediaLite[]>();
  if (keys.length === 0) return out;
  const { rows } = await client.query(
    `SELECT m.id, m.storage_key, m.organization_id, m.space_id, m.filename, m.mime_type, m.size_bytes
       FROM media m JOIN spaces ms ON ms.id = m.space_id
      WHERE m.organization_id = $1 AND ms.organization_id = $1
        AND m.deleted_at IS NULL AND m.storage_key = ANY($3::text[])
        AND (m.space_id = $2 OR (ms.type = 'organization' AND COALESCE(ms.classification, '') <> 'secret'))`,
    [orgId, spaceId, keys]
  );
  for (const r of rows) {
    const m = toLite(r);
    out.set(m.storageKey, [...(out.get(m.storageKey) ?? []), m]);
  }
  return out;
}

async function mediaBySignature(
  client: PoolClient,
  orgId: string,
  spaceId: string,
  sig: { filename: string; mimeType: string; size: number }
): Promise<LookupResult> {
  const { rows } = await client.query(
    `SELECT id, storage_key, organization_id, space_id, filename, mime_type, size_bytes
       FROM media
      WHERE organization_id = $1 AND space_id = $2 AND deleted_at IS NULL
        AND filename = $3 AND mime_type = $4 AND size_bytes = $5
      LIMIT 2`,
    [orgId, spaceId, sig.filename, sig.mimeType, sig.size]
  );
  if (rows.length === 0) return { status: "not_found" };
  if (rows.length > 1) return { status: "ambiguous" };
  return { status: "found", media: toLite(rows[0]) };
}

function legacyKeys(cells: Record<string, unknown>, cols: ColumnInfo[]): string[] {
  const keys = new Set<string>();
  for (const col of cols) {
    const v = cells[col.id];
    if (col.type === "image" && typeof v === "string") {
      const m = /^\/api\/attachments\/([^?#]+)/.exec(v.trim());
      if (m) {
        try {
          keys.add(decodeURIComponent(m[1]));
        } catch {
          keys.add(m[1]);
        }
      }
    } else if (col.type === "attachment" && Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === "object" && typeof (it as { key?: unknown }).key === "string") {
          keys.add((it as { key: string }).key);
        }
      }
    }
  }
  return [...keys];
}

interface PlannedWrite {
  rowId: string;
  columnId: string;
  before: unknown;
  after: unknown;
}

export async function rewriteCells(pool: Pool, mode: RewriteMode, report: Report): Promise<{ written: number }> {
  const client = await pool.connect();
  let written = 0;
  let examined = 0;
  try {
    const databases = await loadDatabases(client, mode);
    for (const database of databases) {
      let lastId = "00000000-0000-0000-0000-000000000000";
      let batchNo = 0;
      for (;;) {
        if (mode.limit !== undefined && examined >= mode.limit) break;
        const take = mode.limit !== undefined ? Math.min(BATCH_SIZE, mode.limit - examined) : BATCH_SIZE;
        const { rows } = await client.query(
          `SELECT id, cells FROM user_database_rows WHERE database_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
          [database.id, lastId, take]
        );
        if (rows.length === 0) break;
        lastId = rows[rows.length - 1].id;
        examined += rows.length;

        const keys = new Set<string>();
        for (const r of rows) legacyKeys((r.cells ?? {}) as Record<string, unknown>, database.columns).forEach((k) => keys.add(k));
        const known = await mediaByKeys(client, database.organizationId, database.spaceId, [...keys]);
        const lookupByKey = (k: string): LookupResult => {
          const c = known.get(k) ?? [];
          if (c.length === 0) return { status: "not_found" };
          if (c.length > 1) return { status: "ambiguous" };
          return { status: "found", media: c[0] };
        };

        const writes: PlannedWrite[] = [];
        for (const r of rows) {
          const cells = (r.cells ?? {}) as Record<string, unknown>;
          for (const col of database.columns) {
            if (!(col.id in cells)) continue;
            const before = cells[col.id];
            const ref = { table: "user_database_rows", id: r.id, detail: `colonne ${col.id}` };
            if (col.type === "image") {
              const res = rewriteImageCell(before, lookupByKey);
              report.add("cell:image", res.outcome, ref);
              if (res.outcome === "rewritten") writes.push({ rowId: r.id, columnId: col.id, before, after: res.next });
            } else {
              // Résolution par signature : pré-calculée de façon synchrone via un cache rempli ci-dessous.
              const sigResults = new Map<string, LookupResult>();
              if (Array.isArray(before)) {
                for (const it of before) {
                  if (!it || typeof it !== "object") continue;
                  const o = it as { key?: unknown; filename?: unknown; mimeType?: unknown; size?: unknown };
                  const hasKey = typeof o.key === "string" && o.key.trim() !== "";
                  if (!hasKey && typeof o.filename === "string" && typeof o.mimeType === "string" && typeof o.size === "number" && o.size > 0) {
                    const sk = `${o.filename}\u0000${o.mimeType}\u0000${o.size}`;
                    if (!sigResults.has(sk)) {
                      sigResults.set(
                        sk,
                        await mediaBySignature(client, database.organizationId, database.spaceId, {
                          filename: o.filename,
                          mimeType: o.mimeType,
                          size: o.size,
                        })
                      );
                    }
                  }
                }
              }
              const res = rewriteAttachmentCell(before, {
                lookupByKey,
                lookupByNameSizeInSpace: (f) =>
                  sigResults.get(`${f.filename}\u0000${f.mimeType}\u0000${f.size}`) ?? { status: "not_found" },
              });
              for (const o of res.outcomes) report.add("cell:attachment", o, ref);
              if (res.next !== before) writes.push({ rowId: r.id, columnId: col.id, before, after: res.next });
            }
          }
        }

        if (mode.apply && writes.length > 0) {
          writeBackup(
            BACKUP_DIR,
            `cells-${database.id}-${++batchNo}`,
            writes.map((w) => ({ id: `${w.rowId}:${w.columnId}`, before: w.before }))
          );
          await client.query("BEGIN");
          try {
            await client.query("SELECT set_config('loriax.row_ctx', $1, true)", [
              JSON.stringify({ source: "system", actorLabel: "Migration médiathèque", batchId: randomUUID() }),
            ]);
            for (const w of writes) {
              const res = await client.query(
                `UPDATE user_database_rows
                    SET cells = jsonb_set(cells, ARRAY[$2::text], $3::jsonb), updated_at = now()
                  WHERE id = $1 AND cells -> $2::text = $4::jsonb`,
                [w.rowId, w.columnId, JSON.stringify(w.after), JSON.stringify(w.before)]
              );
              if (res.rowCount === 1) written++;
              else report.add("cell", "skipped_concurrent", { table: "user_database_rows", id: w.rowId, detail: `colonne ${w.columnId}` });
            }
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          }
        }
      }
    }
  } finally {
    client.release();
  }
  return { written };
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const url = requireDatabaseUrl();
  assertTargetAllowed(url, mode);
  const target = describeTarget(url);
  console.log(`Base cible : ${target} (${mode.apply ? "ÉCRITURE" : "simulation"})`);
  const pool = new Pool({ connectionString: url });
  try {
    const report = new Report({ script: "rewrite-cells", apply: mode.apply, target });
    const { written } = await rewriteCells(pool, mode, report);
    mkdirSync(dirname(mode.reportPath), { recursive: true });
    writeFileSync(mode.reportPath, JSON.stringify(report.toJSON(), null, 2), "utf8");
    console.log(report.toText());
    console.log(`Lignes écrites : ${written}. Rapport : ${mode.reportPath}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
