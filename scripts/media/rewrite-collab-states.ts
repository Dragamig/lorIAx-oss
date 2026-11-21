/**
 * B123 : réécrit les références `/api/attachments/<clé>` des états Yjs (document_collab_states)
 * en `/api/media/<id>`, puis régénère le Markdown disque et `content_text` depuis l'état réécrit
 * (syncYjsToStorage), donc sans divergence possible entre état, base et fichier.
 * Simulation par défaut ; --apply écrit après sauvegarde, par mise à jour conditionnelle sur l'état lu.
 * --apply exige --confirm-db=<nom de la base cible> ; une base nommée `loriax` exige --confirm-db=loriax
 * même en simulation. --apply et --dry-run sont exclusifs et sans valeur.
 * Les états modifiés depuis moins de --min-idle-minutes (10) sont ignorés : un serveur collaboratif
 * vivant les réécraserait (lancer de préférence serveur collaboratif arrêté, ou relancer une simulation
 * plus tard et exiger zéro rewrite_state : un document ouvert depuis plus de 10 minutes sans frappe peut
 * réécraser la réécriture au prochain enregistrement du serveur).
 * WORKSPACES_PATH est obligatoire et doit désigner un dossier existant : le script ne crée jamais de dépôt Git.
 * Décision par comparaison : un document est écrit seulement si son fichier actuel, une fois les anciennes
 * URL résolues substituées, égale le Markdown régénéré depuis l'état, ou si ce fichier égale le Markdown de
 * l'ancien convertisseur (sans images) pour l'état d'origine (sinon statut disk_diverged, rien écrit).
 *   npm run media:rewrite-collab -- [--apply --confirm-db <base>] [--org <uuid>] [--limit N]
 *     [--min-idle-minutes N] [--report <fichier>]
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import * as Y from "yjs";
import { extractTextFromYDoc, syncYjsToStorage } from "@/lib/collab/markdown-sync";
import { collectLegacyKeys, rewriteYDocMediaRefs } from "@/lib/collab/rewrite-media-refs";
import { createOrgKeyLookup } from "@/lib/media/attachment-key-lookup";
import { UUID_RE, type LookupResult } from "@/lib/media/rewrite-document-refs";
import { extractMediaRefs, syncDocumentUsages, type MediaRef } from "@/lib/media/usages";
import { getWorkspacePath, readDocument } from "@/lib/storage/filesystem";
import {
  describeTarget,
  parseMode,
  requireDatabaseUrl,
  assertTargetAllowed,
  writeBackup,
  type RewriteMode,
} from "./lib/plan";
import { Report } from "./lib/report";
import {
  checkReferenceGuard,
  classifyDocument,
  collectMarkdownKeys,
  diskDifferenceIsOnlyRefs,
  diskMatchesLegacyConverter,
  normalizeMarkdown,
  toReportOutcome,
  type CollabReportEntry,
  type CollabStatus,
} from "./lib/collab-plan";

const BATCH_SIZE = 100;
const BACKUP_DIR = "tmp/media-rewrite/collab";
const DEFAULT_MIN_IDLE = 10;
const COMMIT_MESSAGE = "Migration des références média (état collaboratif)";
const COMMIT_AUTHOR = { name: "LorIAx Migration", email: "migration@loriax.local" };

export interface CollabOptions {
  minIdleMinutes?: number;
  /** Appelé juste avant la mise à jour conditionnelle (tests de concurrence). */
  beforeWrite?: (documentId: string) => Promise<void>;
}

export interface CollabCounters {
  examined: number;
  rewritten: number;
  resynced: number;
  clean: number;
  active: number;
  skipped_concurrent: number;
  skipped_guard: number;
  disk_diverged: number;
  markdown_stale: number;
  error: number;
  unresolved_keys: number;
}

export interface CollabResult {
  entries: CollabReportEntry[];
  counters: CollabCounters;
}

interface Row {
  document_id: string;
  yjs_state: string;
  idle_minutes: number;
  content_text: string | null;
  file_path: string;
  space_id: string;
  organization_id: string;
  git_repo_path: string;
}

/** Forme comparable d'une référence : l'identifiant du média quand la clé se résout, sinon la clé. */
function canon(refs: MediaRef[], known: Map<string, LookupResult>): string[] {
  return refs.map((r) => {
    if ("mediaId" in r) return `id:${r.mediaId}`;
    const hit = known.get(r.storageKey);
    return hit && hit.status === "found" ? `id:${hit.id.toLowerCase()}` : `key:${r.storageKey}`;
  });
}

async function processDocument(
  pool: Pool,
  row: Row,
  mode: RewriteMode,
  minIdle: number,
  opts: CollabOptions,
): Promise<CollabReportEntry> {
  const base = { documentId: row.document_id, orgId: row.organization_id, rewritten: 0, skipped: 0 };
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, Buffer.from(row.yjs_state, "base64"));

  // Le script ne crée jamais de dépôt : dépôt et fichier doivent exister.
  try {
    await access(join(getWorkspacePath(row.git_repo_path), ".git", "HEAD"));
  } catch {
    return { ...base, status: "error", reason: `dépôt Git absent pour l'espace (${row.git_repo_path}), rien écrit` };
  }
  let diskText: string;
  try {
    diskText = await readDocument(row.git_repo_path, row.file_path);
  } catch (err) {
    return { ...base, status: "error", reason: `fichier disque illisible (${err instanceof Error ? err.message : String(err)}), rien écrit` };
  }

  // Résolution dans l'organisation et l'espace du document, mémorisée pour la garde.
  const lookup = createOrgKeyLookup(row.organization_id, row.space_id);
  const known = new Map<string, LookupResult>();
  const resolve = async (keys: string[]): Promise<Map<string, LookupResult>> => {
    const need = keys.filter((k) => !known.has(k));
    if (need.length > 0) for (const [k, v] of await lookup(need)) known.set(k, v);
    return new Map(keys.map((k) => [k, known.get(k) ?? ({ status: "missing" } as LookupResult)]));
  };

  const stateKeys = collectLegacyKeys(ydoc);
  const allKeys = [...new Set([...stateKeys, ...collectMarkdownKeys(diskText), ...collectMarkdownKeys(row.content_text)])];
  const found = allKeys.length > 0 ? await resolve(allKeys) : new Map<string, LookupResult>();
  const idOf = new Map<string, string>();
  for (const [key, r] of found) if (r.status === "found" && UUID_RE.test(r.id)) idOf.set(key, r.id.toLowerCase());
  const resolvableInState = stateKeys.filter((k) => idOf.has(k));
  const unresolved = stateKeys.length - resolvableInState.length;

  const regenOld = normalizeMarkdown(extractTextFromYDoc(ydoc));
  // Markdown du convertisseur antérieur (sans images) pour l'état d'origine, calculé avant toute réécriture.
  const legacyOld = extractTextFromYDoc(ydoc, { images: false });
  const contentInSync =
    normalizeMarkdown(diskText) === regenOld && normalizeMarkdown(row.content_text ?? "") === regenOld;
  const action = classifyDocument({
    stateHasResolvable: resolvableInState.length > 0,
    contentInSync,
    idleMinutes: Number(row.idle_minutes),
    minIdle,
  });
  if (action === "skip_clean") return { ...base, status: "skip_clean", skipped: unresolved };
  if (action === "skip_active") return { ...base, status: "skip_active", reason: "état modifié récemment" };

  let rewritten = 0;
  let skipped = 0;
  if (action === "rewrite_state") {
    const res = await rewriteYDocMediaRefs(ydoc, resolve);
    rewritten = res.rewritten;
    skipped = res.skipped;
    if (rewritten === 0) return { ...base, status: "skip_clean", skipped, reason: "clés non résolues" };
  } else {
    skipped = unresolved;
  }
  const markdown = extractTextFromYDoc(ydoc);

  // Garde de non-perte des références (content_text), en mémoire, avant toute écriture.
  const beforeRefs = extractMediaRefs(row.content_text ?? "");
  const before = canon(beforeRefs, known);
  const after = canon(extractMediaRefs(markdown), known);
  if (!checkReferenceGuard(before, after)) {
    const lost = before.filter((b) => !after.includes(b));
    return { ...base, status: "skipped_guard", rewritten, skipped, reason: `références perdues : ${[...new Set(lost)].join(", ")}` };
  }

  // Invariant d'écriture : la seule différence fichier actuel / Markdown régénéré est la substitution des URL résolues.
  // Ou, cas des fichiers écrits par l'ancien convertisseur : égalité avec son rendu de l'état d'origine.
  if (!diskDifferenceIsOnlyRefs(diskText, markdown, idOf) && !diskMatchesLegacyConverter(diskText, legacyOld)) {
    return {
      ...base,
      status: "disk_diverged",
      rewritten,
      skipped,
      reason: "le fichier disque diffère du Markdown régénéré par autre chose que des URL résolues, rien écrit",
    };
  }

  const okStatus: CollabStatus = action === "rewrite_state" ? "rewritten" : "resynced";
  if (!mode.apply) return { ...base, status: okStatus, rewritten, skipped };

  writeBackup(BACKUP_DIR, `collab-${row.document_id}`, [
    {
      id: row.document_id,
      before: { documentId: row.document_id, yjsStateBefore: row.yjs_state, contentTextBefore: row.content_text },
    },
  ]);
  if (opts.beforeWrite) await opts.beforeWrite(row.document_id);
  if (action === "rewrite_state") {
    const next = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64");
    const res = await pool.query(
      "UPDATE document_collab_states SET yjs_state = $2 WHERE document_id = $1 AND yjs_state = $3",
      [row.document_id, next, row.yjs_state],
    );
    if (res.rowCount !== 1) return { ...base, status: "skipped_concurrent", reason: "état modifié entre la lecture et l'écriture" };
  } else {
    const same = await pool.query("SELECT 1 FROM document_collab_states WHERE document_id = $1 AND yjs_state = $2", [
      row.document_id,
      row.yjs_state,
    ]);
    if (same.rowCount !== 1) return { ...base, status: "skipped_concurrent", reason: "état modifié entre la lecture et l'écriture" };
  }

  let synced: boolean;
  if (diskText === markdown) {
    // Fichier déjà à jour : seul content_text est resynchronisé, ni écriture disque ni commit vide.
    await pool.query("UPDATE documents SET content_text = $2 WHERE id = $1", [row.document_id, markdown]);
    synced = true;
  } else {
    synced = await syncYjsToStorage(row.document_id, ydoc, undefined, null, {
      commitMessage: COMMIT_MESSAGE,
      author: COMMIT_AUTHOR,
      touchUpdatedAt: false,
    });
  }
  try {
    await syncDocumentUsages(row.document_id);
  } catch (err) {
    return { ...base, status: "error", rewritten, skipped, reason: `usages : ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!synced) {
    return { ...base, status: "markdown_stale", rewritten, skipped, reason: "écriture base, disque ou commit Git échouée, état déjà réécrit" };
  }
  return { ...base, status: okStatus, rewritten, skipped };
}

function newCounters(): CollabCounters {
  return {
    examined: 0, rewritten: 0, resynced: 0, clean: 0, active: 0,
    skipped_concurrent: 0, skipped_guard: 0, disk_diverged: 0, markdown_stale: 0, error: 0, unresolved_keys: 0,
  };
}

export async function rewriteCollabStates(
  pool: Pool,
  mode: RewriteMode,
  report: Report,
  opts: CollabOptions = {},
  /** Reçoit les entrées et compteurs au fil de l'eau, pour produire un rapport partiel si la passe échoue. */
  partial?: CollabResult,
): Promise<CollabResult> {
  const minIdle = opts.minIdleMinutes ?? DEFAULT_MIN_IDLE;
  const entries: CollabReportEntry[] = partial?.entries ?? [];
  const counters = partial?.counters ?? newCounters();
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    if (mode.limit !== undefined && counters.examined >= mode.limit) break;
    const take = mode.limit !== undefined ? Math.min(BATCH_SIZE, mode.limit - counters.examined) : BATCH_SIZE;
    const params: unknown[] = [lastId, take];
    let orgFilter = "";
    if (mode.org) {
      params.push(mode.org);
      orgFilter = "AND s.organization_id = $3";
    }
    const { rows } = await pool.query<Row>(
      `SELECT cs.document_id, cs.yjs_state, extract(epoch FROM (now() - cs.updated_at)) / 60 AS idle_minutes,
              d.content_text, d.file_path, d.space_id, s.organization_id, s.git_repo_path
         FROM document_collab_states cs
         JOIN documents d ON d.id = cs.document_id
         JOIN spaces s ON s.id = d.space_id
        WHERE cs.document_id > $1 ${orgFilter} ORDER BY cs.document_id LIMIT $2`,
      params,
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].document_id;
    for (const row of rows) {
      counters.examined += 1;
      let entry: CollabReportEntry;
      try {
        entry = await processDocument(pool, row, mode, minIdle, opts);
      } catch (err) {
        entry = {
          documentId: row.document_id, orgId: row.organization_id, status: "error", rewritten: 0, skipped: 0,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      entries.push(entry);
      const ref = { table: "document_collab_states", id: entry.documentId, detail: `${entry.status}${entry.reason ? ` : ${entry.reason}` : ""}` };
      if (entry.status === "skip_clean" && entry.skipped > 0) report.add("collab:document", "key_not_found", ref);
      else report.add("collab:document", toReportOutcome(entry.status), ref);
      if (entry.status === "rewritten" && entry.skipped > 0) {
        report.add("collab:keys", "key_not_found", { ...ref, detail: `${entry.skipped} clé(s) non résolue(s)` });
      }
      switch (entry.status) {
        case "rewritten": counters.rewritten += 1; break;
        case "resynced": counters.resynced += 1; break;
        case "skip_clean": counters.clean += 1; break;
        case "skip_active": counters.active += 1; break;
        default: counters[entry.status] += 1;
      }
      counters.unresolved_keys += entry.skipped;
    }
  }
  return { entries, counters };
}

/** Extrait --min-idle-minutes avant parseMode (option propre à ce script). */
function splitMinIdle(argv: string[]): { rest: string[]; minIdle: number } {
  const rest: string[] = [];
  let minIdle = DEFAULT_MIN_IDLE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--min-idle-minutes" || a.startsWith("--min-idle-minutes=")) {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      const n = Number(v);
      if (v === undefined || v === "" || !Number.isFinite(n) || n < 0) throw new Error("Usage : --min-idle-minutes demande un nombre positif ou nul");
      minIdle = n;
    } else rest.push(a);
  }
  return { rest, minIdle };
}

async function main(): Promise<void> {
  const workspaces = process.env.WORKSPACES_PATH;
  if (!workspaces || !existsSync(workspaces) || !statSync(workspaces).isDirectory()) {
    throw new Error("WORKSPACES_PATH est obligatoire et doit désigner un dossier existant (dépôts Git des espaces) : le script ne crée aucun dépôt");
  }
  const { rest, minIdle } = splitMinIdle(process.argv.slice(2));
  const mode = parseMode(rest);
  const url = requireDatabaseUrl();
  assertTargetAllowed(url, mode);
  const target = describeTarget(url);
  console.log(`Base cible : ${target} (${mode.apply ? "ÉCRITURE" : "simulation"})`);
  console.log(`Dépôts des espaces : ${workspaces}`);
  const pool = new Pool({ connectionString: url });
  const report = new Report({ script: "rewrite-collab-states", apply: mode.apply, target });
  try {
    const partial = { entries: [] as CollabReportEntry[], counters: newCounters() };
    let outcome: CollabResult;
    try {
      outcome = await rewriteCollabStates(pool, mode, report, { minIdleMinutes: minIdle }, partial);
    } catch (err) {
      // Erreur hors document (base injoignable, requête de lot) : code 1, message, rapport partiel.
      process.exitCode = 1;
      console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
      try {
        mkdirSync(dirname(mode.reportPath), { recursive: true });
        writeFileSync(
          mode.reportPath,
          JSON.stringify({ ...report.toJSON(), failed: true, counters: partial.counters, entries: partial.entries }, null, 2),
          "utf8",
        );
        console.error(`Rapport partiel (${partial.entries.length} document(s) traités) : ${mode.reportPath}`);
      } catch {
        // Le rapport partiel est un secours : son échec ne masque pas l'erreur d'origine.
      }
      return;
    }
    const { entries, counters } = outcome;
    mkdirSync(dirname(mode.reportPath), { recursive: true });
    writeFileSync(mode.reportPath, JSON.stringify({ ...report.toJSON(), counters, entries }, null, 2), "utf8");
    console.log(report.toText());
    console.log(
      `Examinés ${counters.examined}, réécrits ${counters.rewritten}, resynchronisés ${counters.resynced}, propres ${counters.clean}, ` +
        `actifs ${counters.active}, conditionnels perdus ${counters.skipped_concurrent}, gardes ${counters.skipped_guard}, disque divergent ${counters.disk_diverged}, ` +
        `disque en retard ${counters.markdown_stale}, erreurs ${counters.error}, clés non résolues ${counters.unresolved_keys}. Rapport : ${mode.reportPath}`,
    );
    if (counters.markdown_stale > 0) console.log("Relancer le script : les Markdown en retard sont resynchronisés.");
  } finally {
    await pool.end();
    // Le client Drizzle de l'application garde son propre pool ouvert.
    process.exit(process.exitCode ?? 0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
