/**
 * Rattrapage : met en file d'indexation IA les médias déjà présents (sans ligne `media_texts`
 * ou dont la version indexée n'est plus la courante), hors corbeille.
 *
 * Dry-run par défaut : un rapport par organisation, aucune écriture. `--apply` ne met en file
 * que les organisations qui ont activé l'indexation. `--limit N` borne le nombre de médias mis
 * en file. `--org <id>` restreint à une organisation.
 *
 * Usage : npx tsx scripts/media-index-backfill.ts [--apply] [--limit N] [--org <id>]
 */
import type { Pool } from "pg";
import { extractableKind } from "../src/lib/media/ai/extract";

export type BackfillOptions = { apply: boolean; limit?: number; orgId?: string };
export type OrgReport = { enabled: boolean; candidates: number; enqueued: number };
export type BackfillReport = { apply: boolean; orgs: Record<string, OrgReport>; candidates: number; enqueued: number };

export type BackfillDeps = {
  pool: Pick<Pool, "query">;
  enqueue: (mediaId: string, trigger: "backfill") => Promise<void>;
  log?: (line: string) => void;
};

type Row = { id: string; organization_id: string; mime_type: string; filename: string; enabled: boolean };

export async function backfillMediaIndex(opts: BackfillOptions, deps: BackfillDeps): Promise<BackfillReport> {
  const log = deps.log ?? (() => undefined);
  const params: unknown[] = [];
  let sql =
    "select m.id, m.organization_id, m.mime_type, m.filename, coalesce(s.index_enabled, false) as enabled " +
    "from media m " +
    "left join media_ai_settings s on s.organization_id = m.organization_id " +
    "left join media_texts t on t.media_id = m.id " +
    "where m.deleted_at is null and m.kind::text in ('pdf','document','audio','video','image') " +
    "and (t.id is null or t.version <> m.current_version)";
  if (opts.orgId) {
    params.push(opts.orgId);
    sql += ` and m.organization_id = $${params.length}`;
  }
  sql += " order by m.created_at";
  const { rows } = await deps.pool.query<Row>(sql, params);

  const report: BackfillReport = { apply: opts.apply, orgs: {}, candidates: 0, enqueued: 0 };
  for (const r of rows) {
    if (!extractableKind(r.mime_type, r.filename)) continue;
    const org = (report.orgs[r.organization_id] ??= { enabled: Boolean(r.enabled), candidates: 0, enqueued: 0 });
    org.candidates++;
    report.candidates++;
    if (!opts.apply) {
      log(`dry-run ${r.id} (${r.organization_id}${org.enabled ? "" : ", indexation désactivée"})`);
      continue;
    }
    if (!org.enabled) continue; // jamais d'indexation pour une organisation qui ne l'a pas activée
    if (opts.limit && report.enqueued >= opts.limit) continue;
    await deps.enqueue(r.id, "backfill");
    org.enqueued++;
    report.enqueued++;
    log(`mis en file ${r.id}`);
  }
  return report;
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
  const { enqueueMediaIndex } = await import("../src/lib/media/ai/enqueue");
  const opts = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const report = await backfillMediaIndex(opts, { pool, enqueue: enqueueMediaIndex, log: (l) => console.log(l) });
    for (const [org, r] of Object.entries(report.orgs)) {
      console.log(`${org} : ${r.candidates} à indexer, ${r.enqueued} mis en file, indexation ${r.enabled ? "activée" : "désactivée"}`);
    }
    console.log(
      `${opts.apply ? "Appliqué" : "Dry-run (ajouter --apply pour écrire)"} : ${report.candidates} candidats, ${report.enqueued} mis en file`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Erreur media-index-backfill :", e?.message ?? e);
    process.exit(1);
  });
}
