/**
 * Rattrapage : miniature de la 1re page des PDF déjà présents dans la médiathèque.
 *
 * Dry-run par défaut (liste et compte, aucune écriture base ni S3). `--apply` écrit.
 * Reprise naturelle : ne traite que `kind = 'pdf' and thumbnail_key is null and deleted_at is null`.
 * Un PDF en échec (illisible, chiffré, trop gros, trop lent) est journalisé et ne bloque pas les suivants.
 *
 * Usage : npx tsx scripts/media-pdf-thumbnails.ts [--apply] [--limit N] [--org <id>]
 */
import type { Pool } from "pg";

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export type BackfillOptions = { apply: boolean; limit?: number; orgId?: string };
export type BackfillStats = { scanned: number; rendered: number; failed: number };

export type BackfillDeps = {
  pool: Pick<Pool, "query">;
  readObject: (key: string) => Promise<Buffer | null>;
  upload: (key: string, body: Buffer, contentType: string) => Promise<unknown>;
  remove?: (key: string) => Promise<unknown>;
  render: (buf: Buffer) => Promise<{ webp: Buffer; pageCount: number } | null>;
  log?: (line: string) => void;
};

type Row = {
  id: string;
  storage_key: string;
  size_bytes: string | number;
  current_version: number;
};

export async function backfillPdfThumbnails(
  opts: BackfillOptions,
  deps: BackfillDeps,
): Promise<BackfillStats> {
  const log = deps.log ?? (() => undefined);
  const params: unknown[] = [];
  let sql =
    "select id, storage_key, size_bytes, current_version from media " +
    "where kind = 'pdf' and thumbnail_key is null and deleted_at is null";
  if (opts.orgId) {
    params.push(opts.orgId);
    sql += ` and organization_id = $${params.length}`;
  }
  sql += " order by created_at";
  if (opts.limit && opts.limit > 0) {
    params.push(Math.floor(opts.limit));
    sql += ` limit $${params.length}`;
  }
  const { rows } = await deps.pool.query<Row>(sql, params);

  const stats: BackfillStats = { scanned: rows.length, rendered: 0, failed: 0 };
  if (!opts.apply) {
    for (const r of rows) log(`dry-run ${r.id} ${r.storage_key}`);
    return stats;
  }

  for (const r of rows) {
    try {
      if (Number(r.size_bytes) > MAX_PDF_BYTES) throw new Error("PDF trop gros");
      const buf = await deps.readObject(r.storage_key);
      if (!buf) throw new Error("objet introuvable");
      const page = await deps.render(buf);
      if (!page) throw new Error("rendu impossible");
      const thumbKey = `${r.storage_key}.thumb.webp`;
      await deps.upload(thumbKey, page.webp, "image/webp");
      const upd = await deps.pool.query(
        "update media set thumbnail_key = $2, page_count = $3 where id = $1 and thumbnail_key is null and storage_key = $4",
        [r.id, thumbKey, page.pageCount, r.storage_key],
      );
      if (!upd.rowCount) {
        // Version remplacée (ou miniature déjà posée) entre la lecture et l'écriture.
        await deps.remove?.(thumbKey).catch(() => undefined);
        log(`ignoré ${r.id} : version modifiée entre-temps`);
        continue;
      }
      await deps.pool.query(
        "update media_versions set thumbnail_key = $2, page_count = $3 where media_id = $1 and version = $4",
        [r.id, thumbKey, page.pageCount, r.current_version],
      );
      stats.rendered++;
      log(`ok ${r.id}`);
    } catch (e) {
      stats.failed++;
      log(`échec ${r.id} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return stats;
}

export function parseArgs(argv: string[]): BackfillOptions {
  const opts: BackfillOptions = { apply: argv.includes("--apply") };
  const li = argv.indexOf("--limit");
  if (li >= 0) {
    const n = Number(argv[li + 1]);
    if (Number.isInteger(n) && n > 0) opts.limit = n;
  }
  const oi = argv.indexOf("--org");
  if (oi >= 0 && argv[oi + 1]) opts.orgId = argv[oi + 1];
  return opts;
}

async function main() {
  const { Pool } = await import("pg");
  const { getFileBuffer, uploadFile, deleteFile } = await import("../src/lib/storage/s3");
  const { renderPdfFirstPage } = await import("../src/lib/media/pdf-thumbnail");
  const opts = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const stats = await backfillPdfThumbnails(opts, {
      pool,
      readObject: getFileBuffer,
      upload: uploadFile,
      remove: deleteFile,
      render: renderPdfFirstPage,
      log: (l) => console.log(l),
    });
    console.log(
      `${opts.apply ? "Appliqué" : "Dry-run (ajouter --apply pour écrire)"} : ${stats.scanned} PDF sans miniature, ${stats.rendered} rendus, ${stats.failed} en échec`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Erreur media-pdf-thumbnails :", e?.message ?? e);
    process.exit(1);
  });
}
