/**
 * B123, tâche 14 : mesure, en lecture seule, l'intégrité de la copie attachments / studio_images vers
 * media et compte les références restantes à l'ancienne forme /api/attachments/<clé>, avant le retrait.
 * Aucune option d'écriture : la session est ouverte en transaction READ ONLY.
 * Code de sortie : 0 aucune orpheline inaccessible d'attachments (ou table déjà retirée, c'est-à-dire absente de public ou
 * archivée dans legacy_archive), 2 au moins une, 1 erreur. Les orphelines de studio_images sont comptées sans bloquer.
 *   npm run media:legacy-refs -- [--org <uuid>] [--report <fichier>]
 * Les tables sont lues en SQL brut : la table attachments peut être absente.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import * as Y from "yjs";
import { collectLegacyKeys } from "@/lib/collab/rewrite-media-refs";
import { DEFAULT_REPORT_PATH, assertTargetAllowed, describeTarget, parseMode, requireDatabaseUrl, type RewriteMode } from "./lib/plan";
import { idMatchSql, keyMatchSql, keyOtherOrgSql } from "./lib/copy-integrity";
import { Report } from "./lib/report";
import {
  LegacyTally,
  cellLegacyKeys,
  classifyCopy,
  classifyKey,
  designThumbnailKeys,
  exitCodeFor,
  legacyKeysInText,
  logoLegacyKeys,
  timelineLegacyKeys,
  type CopyStatus,
  type KeyStatus,
  type Surface,
} from "./lib/legacy-refs";

const BATCH_SIZE = 200;
const STATE_BATCH_SIZE = 25;
const NIL = "00000000-0000-0000-0000-000000000000";

export interface CopyIntegrity {
  total: number;
  copied_by_id: number;
  copied_by_key: number;
  copied_by_key_other_org: number;
  orphan_unreachable: number;
}

export interface LegacyRefsResult {
  exitCode: 0 | 2;
  attachments: CopyIntegrity | "table_retiree";
  studioImages: CopyIntegrity | "table_retiree";
  references: ReturnType<LegacyTally["toJSON"]>;
}

const emptyIntegrity = (): CopyIntegrity => ({ total: 0, copied_by_id: 0, copied_by_key: 0, copied_by_key_other_org: 0, orphan_unreachable: 0 });

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [name]);
  return rows[0].present === true;
}

/** Nombre de médias non supprimés par clé dans le périmètre lisible depuis l'espace donné. */
async function keyCandidates(
  client: PoolClient,
  orgId: string,
  spaceId: string | null,
  keys: string[],
  orgWide = true,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  const { rows } = await client.query(
    `SELECT m.storage_key, count(*)::int AS n
       FROM media m JOIN spaces ms ON ms.id = m.space_id
      WHERE m.organization_id = $1 AND ms.organization_id = $1
        AND m.deleted_at IS NULL AND m.storage_key = ANY($3::text[])
        AND (m.space_id = $2::uuid OR ($4::boolean AND ms.type = 'organization' AND COALESCE(ms.classification::text, '') <> 'secret'))
      GROUP BY m.storage_key`,
    [orgId, spaceId, keys, orgWide],
  );
  for (const r of rows) out.set(r.storage_key, r.n);
  return out;
}

async function tallyKeys(
  client: PoolClient,
  tally: LegacyTally,
  report: Report,
  surface: Surface,
  ref: { table: string; id: string },
  ctx: { orgId: string; spaceId: string | null; orgWide?: boolean },
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  const known = await keyCandidates(client, ctx.orgId, ctx.spaceId, keys, ctx.orgWide ?? true);
  const status = (k: string): KeyStatus => classifyKey(known.get(k) ?? 0);
  tally.addRow(surface, keys, status);
  for (const k of keys) {
    const s = status(k);
    const outcome = s === "resolvable" ? "unchanged" : s === "missing" ? "key_not_found" : "ambiguous";
    report.add(`ref:${surface}`, outcome, { ...ref, detail: k });
  }
}

async function copyIntegrity(
  client: PoolClient,
  report: Report,
  kind: "attachments" | "studio_images",
  mode: RewriteMode,
): Promise<CopyIntegrity | "table_retiree"> {
  if (!(await tableExists(client, kind))) return "table_retiree";
  const out = emptyIntegrity();
  const idOnly = kind === "studio_images";
  const keyCol = idOnly ? "s_key" : "storage_key";
  const from =
    kind === "attachments"
      ? `attachments t ${mode.org ? "JOIN spaces sp ON sp.id = t.space_id" : ""}`
      : "studio_images t";
  const orgFilter = mode.org ? (kind === "attachments" ? "AND sp.organization_id = $3" : "AND t.organization_id = $3") : "";
  let last = NIL;
  for (;;) {
    const params: unknown[] = [last, BATCH_SIZE];
    if (mode.org) params.push(mode.org);
    const { rows } = await client.query(
      `SELECT t.id, ${idOnly ? "t.s3_key" : "t.storage_key"} AS ${keyCol},
              ${idMatchSql("t")} AS id_match,
              ${keyMatchSql(kind, "t")} AS key_match,
              ${keyOtherOrgSql(kind, "t")} AS key_other_org
         FROM ${from} WHERE t.id > $1 ${orgFilter} ORDER BY t.id LIMIT $2`,
      params,
    );
    if (rows.length === 0) break;
    last = rows[rows.length - 1].id;
    for (const r of rows) {
      const status: CopyStatus = classifyCopy({ idMatch: r.id_match, keyMatch: r.key_match, keyOtherOrg: r.key_other_org }, { idOnly });
      out.total += 1;
      out[status] += 1;
      if (status === "orphan_unreachable") report.add(`copy:${kind}`, "orphan", { table: kind, id: r.id, detail: r[keyCol] });
    }
  }
  return out;
}

export async function countLegacyRefs(pool: Pool, mode: RewriteMode, report: Report): Promise<LegacyRefsResult> {
  const client = await pool.connect();
  const tally = new LegacyTally();
  try {
    await client.query("BEGIN READ ONLY");
    const attachments = await copyIntegrity(client, report, "attachments", mode);
    const studioImages = await copyIntegrity(client, report, "studio_images", mode);

    const orgSql = (n: number) => (mode.org ? `AND s.organization_id = $${n}` : "");
    const orgParam = (base: unknown[]) => (mode.org ? [...base, mode.org] : base);

    // Documents : Markdown stocké (content_text).
    for (let last = NIL; ; ) {
      const { rows } = await client.query(
        `SELECT d.id, d.space_id, s.organization_id, d.content_text
           FROM documents d JOIN spaces s ON s.id = d.space_id
          WHERE d.id > $1 AND d.content_text LIKE '%/api/attachments/%' ${orgSql(3)} ORDER BY d.id LIMIT $2`,
        orgParam([last, BATCH_SIZE]),
      );
      if (rows.length === 0) break;
      last = rows[rows.length - 1].id;
      for (const r of rows) {
        await tallyKeys(client, tally, report, "content_text", { table: "documents", id: r.id }, { orgId: r.organization_id, spaceId: r.space_id }, legacyKeysInText(r.content_text));
      }
    }

    // États Yjs : décodés un par un, par petits lots.
    for (let last = NIL; ; ) {
      const { rows } = await client.query(
        `SELECT cs.document_id, d.space_id, s.organization_id, cs.yjs_state
           FROM document_collab_states cs
           JOIN documents d ON d.id = cs.document_id JOIN spaces s ON s.id = d.space_id
          WHERE cs.document_id > $1 ${orgSql(3)} ORDER BY cs.document_id LIMIT $2`,
        orgParam([last, STATE_BATCH_SIZE]),
      );
      if (rows.length === 0) break;
      last = rows[rows.length - 1].document_id;
      for (const r of rows) {
        const ref = { table: "document_collab_states", id: r.document_id };
        const ctx = { orgId: r.organization_id, spaceId: r.space_id };
        let keys: string[] = [];
        let thumbs: string[] = [];
        try {
          const ydoc = new Y.Doc();
          Y.applyUpdate(ydoc, Buffer.from(r.yjs_state, "base64"));
          keys = collectLegacyKeys(ydoc);
          thumbs = designThumbnailKeys(ydoc);
        } catch {
          report.add("ref:yjs_state", "unparseable", ref);
          continue;
        }
        await tallyKeys(client, tally, report, "yjs_state", ref, ctx, keys);
        await tallyKeys(client, tally, report, "design_thumbnail", ref, ctx, thumbs);
      }
    }

    // Cellules image et pièces jointes.
    const { rows: cols } = await client.query(
      `SELECT d.id AS database_id, d.space_id, s.organization_id, c.id AS column_id, c.type
         FROM user_database_columns c
         JOIN user_databases d ON d.id = c.database_id JOIN spaces s ON s.id = d.space_id
        WHERE c.type IN ('image', 'attachment') ${orgSql(1)} ORDER BY d.id, c.position`,
      orgParam([]),
    );
    const dbs = new Map<string, { spaceId: string; orgId: string; cols: Array<{ id: string; type: "image" | "attachment" }> }>();
    for (const c of cols) {
      const e = dbs.get(c.database_id) ?? { spaceId: c.space_id, orgId: c.organization_id, cols: [] as Array<{ id: string; type: "image" | "attachment" }> };
      e.cols.push({ id: c.column_id, type: c.type });
      dbs.set(c.database_id, e);
    }
    for (const [dbId, db] of dbs) {
      for (let last = NIL; ; ) {
        const { rows } = await client.query(
          `SELECT id, cells FROM user_database_rows WHERE database_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
          [dbId, last, BATCH_SIZE],
        );
        if (rows.length === 0) break;
        last = rows[rows.length - 1].id;
        for (const r of rows) {
          await tallyKeys(client, tally, report, "cells", { table: "user_database_rows", id: r.id }, { orgId: db.orgId, spaceId: db.spaceId }, cellLegacyKeys((r.cells ?? {}) as Record<string, unknown>, db.cols));
        }
      }
    }

    // Projets vidéo : sourceKey sans mediaId (même espace seulement, comme la réécriture).
    for (let last = NIL; ; ) {
      const { rows } = await client.query(
        `SELECT p.id, p.space_id, s.organization_id, p.timeline_json
           FROM video_projects p JOIN spaces s ON s.id = p.space_id
          WHERE p.id > $1 ${orgSql(3)} ORDER BY p.id LIMIT $2`,
        orgParam([last, BATCH_SIZE]),
      );
      if (rows.length === 0) break;
      last = rows[rows.length - 1].id;
      for (const r of rows) {
        await tallyKeys(client, tally, report, "timeline", { table: "video_projects", id: r.id }, { orgId: r.organization_id, spaceId: r.space_id, orgWide: false }, timelineLegacyKeys(r.timeline_json));
      }
    }

    // Logos du Brand Kit : niveau organisation, donc espaces d'organisation non secrets seulement.
    for (let last = NIL; ; ) {
      const { rows } = await client.query(
        `SELECT id, organization_id, logos FROM brand_kits
          WHERE id > $1 ${mode.org ? "AND organization_id = $3" : ""} ORDER BY id LIMIT $2`,
        orgParam([last, BATCH_SIZE]),
      );
      if (rows.length === 0) break;
      last = rows[rows.length - 1].id;
      for (const r of rows) {
        await tallyKeys(client, tally, report, "brand_logo", { table: "brand_kits", id: r.id }, { orgId: r.organization_id, spaceId: null }, logoLegacyKeys(r.logos));
      }
    }

    await client.query("ROLLBACK");
    const orphans = (v: CopyIntegrity | "table_retiree") => (v === "table_retiree" ? 0 : v.orphan_unreachable);
    return {
      exitCode: exitCodeFor({ attachmentsOrphans: orphans(attachments) }),
      attachments,
      studioImages,
      references: tally.toJSON(),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function formatText(result: LegacyRefsResult, report: Report): string {
  const lines: string[] = [report.toText().split("\n")[0]];
  const copy = (label: string, v: CopyIntegrity | "table_retiree") =>
    v === "table_retiree"
      ? `${label} : table déjà retirée`
      : `${label} : ${v.total} lignes, copiées par id ${v.copied_by_id}, par clé de la même organisation ${v.copied_by_key}, par clé d'une autre organisation ${v.copied_by_key_other_org}, orphelines inaccessibles ${v.orphan_unreachable}${label === "studio_images" ? " (non bloquantes)" : ""}`;
  lines.push(copy("attachments", result.attachments), copy("studio_images", result.studioImages));
  lines.push("Références restantes à /api/attachments (références, lignes concernées) :");
  for (const [surface, c] of Object.entries(result.references)) {
    lines.push(`  ${surface} : résolvables ${c.resolvable}, introuvables ${c.missing}, ambiguës ${c.ambiguous} (${c.rows} lignes)`);
  }
  lines.push(result.exitCode === 2 ? "Orpheline inaccessible d'attachments présente : le retrait doit être refusé." : "Aucune orpheline inaccessible d'attachments.");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  if (mode.apply) throw new Error("Script en lecture seule : --apply n'existe pas ici.");
  const url = requireDatabaseUrl();
  assertTargetAllowed(url, mode);
  const target = describeTarget(url);
  console.log(`Base cible : ${target} (lecture seule)`);
  const pool = new Pool({ connectionString: url });
  try {
    if (mode.reportPath === DEFAULT_REPORT_PATH) mode.reportPath = "tmp/media-rewrite/legacy-refs.json";
    const report = new Report({ script: "count-legacy-refs", apply: false, target });
    const result = await countLegacyRefs(pool, mode, report);
    mkdirSync(dirname(mode.reportPath), { recursive: true });
    writeFileSync(mode.reportPath, JSON.stringify({ ...result, report: report.toJSON() }, null, 2), "utf8");
    console.log(formatText(result, report));
    console.log(`Rapport : ${mode.reportPath}`);
    process.exitCode = result.exitCode;
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
