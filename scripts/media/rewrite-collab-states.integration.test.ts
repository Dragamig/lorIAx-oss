/**
 * Exécution réelle de media:rewrite-collab contre une base de test dédiée (schéma complet de l'application).
 * Requiert MEDIA_TEST_DATABASE_URL (base dont le nom contient "test") ; ignoré sinon.
 * Les espaces sont des dépôts Git temporaires.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import git from "isomorphic-git";
import * as fs from "node:fs";
import { Pool } from "pg";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Report as ReportT } from "./lib/report";

const URL_ = process.env.MEDIA_TEST_DATABASE_URL;
const DB_NAME = URL_ ? new URL(URL_).pathname.replace(/^\//, "") : "";
if (URL_ && !DB_NAME.includes("test")) {
  throw new Error(`MEDIA_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const ROOT = mkdtempSync(join(tmpdir(), "collab-rewrite-"));
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.WORKSPACES_PATH = ROOT;
}

type Mod = typeof import("./rewrite-collab-states");
type RewriteOpts = NonNullable<Parameters<Mod["rewriteCollabStates"]>[3]>;

function el(name: string, attrs: Record<string, string> = {}) {
  const e = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function para(parts: Array<string | { text: string; href: string }>) {
  const p = el("paragraph");
  const t = new Y.XmlText();
  p.insert(0, [t]);
  let i = 0;
  for (const part of parts) {
    if (typeof part === "string") {
      t.insert(i, part);
      i += part.length;
    } else {
      t.insert(i, part.text, { link: { href: part.href, title: null } });
      i += part.text.length;
    }
  }
  return p;
}

function docOf(...nodes: Array<Y.XmlElement>) {
  const d = new Y.Doc();
  d.getXmlFragment("default").insert(0, nodes);
  return d;
}

const b64 = (d: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(d)).toString("base64");
const decode = (s: string) => {
  const d = new Y.Doc();
  Y.applyUpdate(d, Buffer.from(s, "base64"));
  return d;
};

describe.skipIf(!URL_)("media:rewrite-collab (base de test)", () => {
  let pool: Pool;
  let mod: Mod;
  let ReportCls: typeof import("./lib/report").Report;
  let extractText: (d: Y.Doc, o?: { images?: boolean }) => string;
  let collectKeys: (d: Y.Doc) => string[];
  let commitFile: typeof import("@/lib/git/repository").commitFile;
  let writeDoc: typeof import("@/lib/storage/filesystem").writeDocument;

  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const ORG_C = randomUUID();
  const SP_A = randomUUID();
  const SP_B = randomUUID();
  const SP_C = randomUUID();
  const ORG_D = randomUUID();
  const SP_D = randomUUID();
  const SP_D_ORGWIDE = randomUUID();
  const SP_D_SECRET = randomUUID();
  const SP_D_OTHER = randomUUID();
  const SP_D_NOREPO = randomUUID();
  const USER = randomUUID();
  const M_IMG = randomUUID();
  const M_PDF = randomUUID();
  const M_THUMB = randomUUID();
  const M_B = randomUUID();
  const M_C = randomUUID();
  const M_D1 = randomUUID();
  const M_D_ORGWIDE = randomUUID();
  const M_D_SECRET = randomUUID();
  const M_D_OTHER = randomUUID();
  const M_D_NOSPACE = randomUUID();
  const docs = {
    images: randomUUID(),
    design: randomUUID(),
    missing: randomUUID(),
    cross: randomUUID(),
    clean: randomUUID(),
    active: randomUUID(),
    noState: randomUUID(),
    guard: randomUUID(),
    orgB: randomUUID(),
    race: randomUUID(),
    disk: randomUUID(),
    designBare: randomUUID(),
    textUrl: randomUUID(),
    studio: randomUUID(),
  };
  const repoOf = (spaceId: string) =>
    spaceId === SP_A ? "space-a" : spaceId === SP_B ? "space-b" : spaceId === SP_C ? "space-c" : spaceId === SP_D_NOREPO ? "space-norepo" : "space-d";
  const ids = [ORG_A, ORG_B, ORG_C, ORG_D];
  const allSpaces = [SP_A, SP_B, SP_C, SP_D, SP_D_ORGWIDE, SP_D_SECRET, SP_D_OTHER, SP_D_NOREPO];

  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  const commits = async (repo: string) => {
    try {
      return (await git.log({ fs, dir: join(ROOT, repo) })).length;
    } catch {
      return 0;
    }
  };

  async function seedDoc(opts: {
    id: string;
    spaceId: string;
    orgId: string;
    ydoc?: Y.Doc;
    markdown?: string;
    idleMinutes?: number;
  }) {
    const markdown = opts.markdown ?? (opts.ydoc ? extractText(opts.ydoc) : "");
    const filePath = `${opts.id}.md`;
    await q(
      `insert into documents (id, space_id, title, slug, file_path, created_by, content_text, updated_at)
       values ($1,$2,$3,$3,$4,$5,$6,'2020-01-01')`,
      [opts.id, opts.spaceId, `doc-${opts.id.slice(0, 8)}`, filePath, USER, markdown],
    );
    await writeDoc(repoOf(opts.spaceId), filePath, markdown);
    await commitFile(repoOf(opts.spaceId), filePath, "seed", "t", "t@t.local");
    if (opts.ydoc) {
      await q(
        `insert into document_collab_states (document_id, yjs_state, updated_at)
         values ($1,$2, now() - ($3 || ' minutes')::interval)`,
        [opts.id, b64(opts.ydoc), String(opts.idleMinutes ?? 120)],
      );
    }
  }

  async function snapshot(orgFilter?: string) {
    const rows = await q(
      `select cs.document_id, cs.yjs_state, cs.updated_at as cs_at, d.content_text, d.updated_at
         from documents d left join document_collab_states cs on cs.document_id = d.id
         join spaces s on s.id = d.space_id
        where ($1::uuid is null or s.organization_id = $1) and s.organization_id = any($2::uuid[]) order by d.id`,
      [orgFilter ?? null, ids],
    );
    const usages = await q(
      `select media_id, target_id from media_usages
        where target_id in (select d.id from documents d join spaces s on s.id = d.space_id where s.organization_id = any($1::uuid[]))
        order by 1,2`,
      [ids],
    );
    const files: Record<string, string> = {};
    const logs: Record<string, number> = {};
    for (const repo of ["space-a", "space-b", "space-c", "space-d"]) {
      logs[repo] = await commits(repo);
      for (const d of (await q(`select file_path from documents d join spaces s on s.id=d.space_id where s.git_repo_path=$1 order by 1`, [repo])).rows) {
        const full = join(ROOT, repo, d.file_path);
        files[`${repo}/${d.file_path}`] = existsSync(full) ? readFileSync(full, "utf8") : "<absent>";
      }
    }
    return createHash("sha256").update(JSON.stringify({ rows: rows.rows, usages: usages.rows, files, logs })).digest("hex");
  }

  const run = (mode: { apply: boolean; org?: string; confirmDb?: string }, report: ReportT, opts: RewriteOpts = {}) =>
    mod.rewriteCollabStates(pool, { reportPath: "x", ...mode }, report, opts);
  const statusOf = (res: Awaited<ReturnType<Mod["rewriteCollabStates"]>>, id: string) =>
    res.entries.find((e) => e.documentId === id)?.status;
  const stateOf = async (id: string) => (await q("select yjs_state from document_collab_states where document_id=$1", [id])).rows[0].yjs_state as string;
  const contentOf = async (id: string) => (await q("select content_text from documents where id=$1", [id])).rows[0].content_text as string;
  const fileOf = (id: string, repo: string) => readFileSync(join(ROOT, repo, `${id}.md`), "utf8");

  beforeAll(async () => {
    mod = await import("./rewrite-collab-states");
    ReportCls = (await import("./lib/report")).Report;
    const sync = await import("@/lib/collab/markdown-sync");
    extractText = sync.extractTextFromYDoc;
    collectKeys = (await import("@/lib/collab/rewrite-media-refs")).collectLegacyKeys;
    commitFile = (await import("@/lib/git/repository")).commitFile;
    writeDoc = (await import("@/lib/storage/filesystem")).writeDocument;
    pool = new Pool({ connectionString: URL_ });

    await q("insert into users (id, email, name) values ($1,$2,'t')", [USER, `t-${USER}@test.local`]);
    for (const [org, sp] of [[ORG_A, SP_A], [ORG_B, SP_B], [ORG_C, SP_C]] as const) {
      await q("insert into organizations (id, slug, name) values ($1,$2,$2)", [org, `org-${org.slice(0, 8)}`]);
      await q("insert into spaces (id, name, slug, git_repo_path, organization_id) values ($1,'s',$2,$3,$4)", [
        sp, `sp-${sp.slice(0, 8)}`, repoOf(sp), org,
      ]);
    }
    await q("insert into organizations (id, slug, name) values ($1,$2,$2)", [ORG_D, `org-${ORG_D.slice(0, 8)}`]);
    for (const [sp, type, cls] of [
      [SP_D, "personal", "internal"],
      [SP_D_ORGWIDE, "organization", "internal"],
      [SP_D_SECRET, "organization", "secret"],
      [SP_D_OTHER, "personal", "internal"],
      [SP_D_NOREPO, "personal", "internal"],
    ] as const) {
      await q(
        "insert into spaces (id, name, slug, git_repo_path, organization_id, type, classification) values ($1,'s',$2,$3,$4,$5,$6)",
        [sp, `sp-${sp.slice(0, 8)}`, repoOf(sp), ORG_D, type, cls],
      );
    }
    const media = (id: string, org: string, space: string, key: string, mime: string, kind: string) =>
      q(
        `insert into media (id, organization_id, space_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,10,$7,$8)`,
        [id, org, space, key.split("/").pop(), mime, kind, key, USER],
      );
    await media(M_IMG, ORG_A, SP_A, `${SP_A}/img1.png`, "image/png", "image");
    await media(M_PDF, ORG_A, SP_A, `${SP_A}/doc.pdf`, "application/pdf", "pdf");
    await media(M_THUMB, ORG_A, SP_A, `${SP_A}/thumb.png`, "image/png", "image");
    await media(M_B, ORG_B, SP_B, `${SP_B}/secret.png`, "image/png", "image");
    await media(M_C, ORG_C, SP_C, `${SP_C}/c.png`, "image/png", "image");

    await media(M_D1, ORG_D, SP_D, `${SP_D}/d1.png`, "image/png", "image");
    await media(M_D_ORGWIDE, ORG_D, SP_D_ORGWIDE, `${SP_D_ORGWIDE}/wide.png`, "image/png", "image");
    await media(M_D_SECRET, ORG_D, SP_D_SECRET, `${SP_D_SECRET}/sec.png`, "image/png", "image");
    await media(M_D_OTHER, ORG_D, SP_D_OTHER, `${SP_D_OTHER}/other.png`, "image/png", "image");
    await q(
      `insert into media (id, organization_id, space_id, filename, mime_type, kind, size_bytes, storage_key, uploaded_by)
       values ($1,$2,null,'n.png','image/png','image',10,$3,$4)`,
      [M_D_NOSPACE, ORG_D, `nospace/${ORG_D}/n.png`, USER],
    );

    const k = (name: string) => `/api/attachments/${SP_A}/${name}`;
    await seedDoc({
      id: docs.images, spaceId: SP_A, orgId: ORG_A,
      ydoc: docOf(
        para(["Voir ", { text: "le pdf", href: k("doc.pdf") }]),
        el("image", { src: k("img1.png"), alt: "a" }),
        el("image", { src: k("img1.png"), alt: "b" }),
      ),
    });
    await seedDoc({
      id: docs.design, spaceId: SP_A, orgId: ORG_A,
      ydoc: docOf(el("designBlock", { designId: "d1", thumbnailUrl: k("thumb.png") }), para(["texte"])),
    });
    await seedDoc({ id: docs.missing, spaceId: SP_A, orgId: ORG_A, ydoc: docOf(el("image", { src: k("absent.png") })) });
    await seedDoc({
      id: docs.cross, spaceId: SP_A, orgId: ORG_A,
      ydoc: docOf(el("image", { src: k("img1.png") }), el("image", { src: `/api/attachments/${SP_B}/secret.png` })),
    });
    await seedDoc({ id: docs.clean, spaceId: SP_A, orgId: ORG_A, ydoc: docOf(el("image", { src: `/api/media/${M_IMG}` })) });
    await seedDoc({ id: docs.active, spaceId: SP_A, orgId: ORG_A, ydoc: docOf(el("image", { src: k("img1.png") })), idleMinutes: 1 });
    await seedDoc({ id: docs.noState, spaceId: SP_A, orgId: ORG_A, markdown: `![x](${k("img1.png")})` });
    await seedDoc({
      id: docs.guard, spaceId: SP_A, orgId: ORG_A,
      ydoc: docOf(el("customEmbed", { src: k("img1.png") })),
      markdown: `![x](${k("img1.png")})`,
    });
    await seedDoc({
      id: docs.designBare, spaceId: SP_A, orgId: ORG_A,
      ydoc: docOf(
        el("designBlock", { designId: "d2", thumbnailUrl: `${SP_A}/thumb.png` }),
        el("fileBlock", { mediaId: M_PDF, filename: "doc.pdf", mimeType: "application/pdf", size: "10" }),
        para(["suite"]),
      ),
    });
    await seedDoc({
      id: docs.textUrl, spaceId: SP_A, orgId: ORG_A,
      ydoc: docOf(para([`texte brut ${k("img1.png")} et clé absente ${k("absent2.png")}`])),
    });
    await seedDoc({
      id: docs.studio, spaceId: SP_A, orgId: ORG_A,
      ydoc: docOf(el("image", { src: `/api/studio/images/${M_IMG}`, alt: "s" })),
    });
    await seedDoc({
      id: docs.orgB, spaceId: SP_B, orgId: ORG_B,
      ydoc: docOf(el("image", { src: `/api/attachments/${SP_B}/secret.png` })),
    });
  });

  afterAll(async () => {
    if (pool) {
      await q("delete from media_usages where target_id in (select id from documents where space_id = any($1::uuid[]))", [allSpaces]).catch(() => {});
      await q("delete from documents where space_id = any($1::uuid[])", [allSpaces]).catch(() => {});
      await q("delete from media where organization_id = any($1::uuid[])", [ids]).catch(() => {});
      await q("delete from spaces where organization_id = any($1::uuid[])", [ids]).catch(() => {});
      await q("delete from organizations where id = any($1::uuid[])", [ids]).catch(() => {});
      await q("delete from users where id = $1", [USER]).catch(() => {});
      await pool.end();
    }
    rmSync(ROOT, { recursive: true, force: true });
  });

  it("simulation : aucune écriture (base, fichiers, Git, updated_at)", async () => {
    const before = await snapshot();
    const report = new ReportCls();
    const res = await run({ apply: false }, report);
    expect(await snapshot()).toBe(before);
    expect(statusOf(res, docs.images)).toBe("rewritten");
    expect(statusOf(res, docs.design)).toBe("rewritten");
    expect(statusOf(res, docs.designBare)).toBe("rewritten");
    expect(statusOf(res, docs.textUrl)).toBe("skip_clean");
    expect(statusOf(res, docs.studio)).toBe("rewritten");
    expect(statusOf(res, docs.active)).toBe("skip_active");
    expect(statusOf(res, docs.clean)).toBe("skip_clean");
    expect(statusOf(res, docs.guard)).toBe("skipped_guard");
    expect(res.entries.find((e) => e.documentId === docs.noState)).toBeUndefined();
    expect(res.counters.rewritten).toBeGreaterThanOrEqual(4);
  });

  it("--apply sans --confirm-db refuse, WORKSPACES_PATH absent ou faux refuse, en ligne de commande", () => {
    const env = { ...process.env, DATABASE_URL: URL_!, WORKSPACES_PATH: ROOT };
    const noWs = spawnSync("npx", ["tsx", "scripts/media/rewrite-collab-states.ts"], {
      env: { ...process.env, DATABASE_URL: URL_!, WORKSPACES_PATH: "" },
      encoding: "utf8",
      timeout: 120000,
    });
    expect(noWs.status).not.toBe(0);
    expect(noWs.stderr).toContain("WORKSPACES_PATH");
    const badWs = spawnSync("npx", ["tsx", "scripts/media/rewrite-collab-states.ts"], {
      env: { ...process.env, DATABASE_URL: URL_!, WORKSPACES_PATH: join(ROOT, "inexistant") },
      encoding: "utf8",
      timeout: 120000,
    });
    expect(badWs.status).not.toBe(0);
    expect(existsSync(join(ROOT, "inexistant"))).toBe(false);
    const refused = spawnSync("npx", ["tsx", "scripts/media/rewrite-collab-states.ts", "--apply"], { env, encoding: "utf8", timeout: 120000 });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("--confirm-db");
    const dry = spawnSync(
      "npx",
      ["tsx", "scripts/media/rewrite-collab-states.ts", "--report", join(ROOT, "cli-report.json")],
      { env, encoding: "utf8", timeout: 120000 },
    );
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("simulation");
  }, 240000);

  it("base injoignable : code de sortie 1, message et rapport partiel", () => {
    const reportPath = join(ROOT, "unreachable-report.json");
    const unreachable = URL_!.replace(/@[^/]+\//, "@localhost:5999/");
    const res = spawnSync("npx", ["tsx", "scripts/media/rewrite-collab-states.ts", "--report", reportPath], {
      env: { ...process.env, DATABASE_URL: unreachable, WORKSPACES_PATH: ROOT },
      encoding: "utf8",
      timeout: 120000,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Erreur");
    expect(JSON.parse(readFileSync(reportPath, "utf8")).failed).toBe(true);
  }, 120000);

  it("--apply : états réécrits, Markdown, fichier et content_text issus de l'état, usages, un commit par document", async () => {
    const logsBefore = { a: await commits("space-a"), b: await commits("space-b") };
    const res = await run({ apply: true, confirmDb: DB_NAME }, new ReportCls());

    // images : deux fois la même image, lien PDF
    const s1 = decode(await stateOf(docs.images));
    expect(collectKeys(s1)).toEqual([]);
    const md1 = extractText(s1);
    expect(md1).toContain(`/api/media/${M_IMG}`);
    expect(md1).toContain(`/api/media/${M_PDF}`);
    expect(await contentOf(docs.images)).toBe(md1);
    expect(fileOf(docs.images, "space-a")).toBe(md1);

    const s2 = decode(await stateOf(docs.design));
    expect(extractText(s2)).toContain(`/api/media/${M_THUMB}`);
    expect(await contentOf(docs.design)).toBe(extractText(s2));
    expect(fileOf(docs.design, "space-a")).toBe(extractText(s2));

    // bloc design à miniature en clé nue : réécrite ; bloc Fichier conservé ; fichier et content_text issus de l'état
    const sb = decode(await stateOf(docs.designBare));
    expect(collectKeys(sb)).toEqual([]);
    const mdb = extractText(sb);
    expect(mdb).toContain(`thumbnailurl="/api/media/${M_THUMB}"`);
    expect(mdb).toContain(`data-media-id="${M_PDF}"`);
    expect(await contentOf(docs.designBare)).toBe(mdb);
    expect(fileOf(docs.designBare, "space-a")).toBe(mdb);
    expect(statusOf(res, docs.designBare)).toBe("rewritten");
    // URL ancienne en texte brut et clé absente : rien écrit, document propre
    expect(statusOf(res, docs.textUrl)).toBe("skip_clean");
    expect(await contentOf(docs.textUrl)).toContain("/api/attachments/");

    const usage = await q("select media_id from media_usages where target_id=$1 order by 1", [docs.images]);
    expect(usage.rows.map((r) => r.media_id).sort()).toEqual([M_IMG, M_PDF].sort());

    // clé inconnue : rien d'écrit ; clé de B : jamais dans un document de A
    expect(statusOf(res, docs.missing)).toBe("skip_clean");
    expect(collectKeys(decode(await stateOf(docs.missing)))).toEqual([`${SP_A}/absent.png`]);
    const cross = decode(await stateOf(docs.cross));
    expect(collectKeys(cross)).toEqual([`${SP_B}/secret.png`]);
    expect(extractText(cross)).toContain(`/api/media/${M_IMG}`);
    expect(extractText(cross)).not.toContain(M_B);
    // organisation B traitée dans B
    expect(extractText(decode(await stateOf(docs.orgB)))).toContain(`/api/media/${M_B}`);

    // garde et actif : inchangés
    expect(statusOf(res, docs.guard)).toBe("skipped_guard");
    expect(collectKeys(decode(await stateOf(docs.guard)))).toEqual([`${SP_A}/img1.png`]);
    expect(await contentOf(docs.guard)).toContain("/api/attachments/");
    expect(statusOf(res, docs.active)).toBe("skip_active");
    expect(collectKeys(decode(await stateOf(docs.active)))).toEqual([`${SP_A}/img1.png`]);

    // un commit par document réécrit (A : images, design, designBare, cross ; B : orgB), updated_at inchangé
    expect(await commits("space-a")).toBe(logsBefore.a + 4);
    expect(await commits("space-b")).toBe(logsBefore.b + 1);
    const upd = await q("select count(*)::int as n from documents where id = any($1::uuid[]) and updated_at <> '2020-01-01'", [Object.values(docs)]);
    expect(upd.rows[0].n).toBe(0);
  });

  it("seconde exécution : zéro changement", async () => {
    const before = await snapshot();
    const res = await run({ apply: true, confirmDb: DB_NAME }, new ReportCls());
    expect(await snapshot()).toBe(before);
    expect(res.counters.rewritten).toBe(0);
    expect(res.counters.resynced).toBe(0);
  });

  it("mise à jour conditionnelle perdue : document ignoré, compté, aucun commit", async () => {
    const id = docs.race;
    await seedDoc({ id, spaceId: SP_C, orgId: ORG_C, ydoc: docOf(el("image", { src: `/api/attachments/${SP_C}/c.png` })) });
    const commitsBefore = await commits("space-c");
    let changed = "";
    const res = await run({ apply: true, org: ORG_C, confirmDb: DB_NAME }, new ReportCls(), {
      beforeWrite: async (docId) => {
        if (docId !== id) return;
        const d = decode(await stateOf(id));
        d.getXmlFragment("default").insert(0, [para(["édition concurrente"])]);
        changed = b64(d);
        await q("update document_collab_states set yjs_state=$2 where document_id=$1", [id, changed]);
        // une vraie édition collaborative resynchronise aussi content_text et le fichier
        const md = extractText(d);
        await q("update documents set content_text=$2 where id=$1", [id, md]);
        await writeDoc("space-c", `${id}.md`, md);
      },
    });
    expect(statusOf(res, id)).toBe("skipped_concurrent");
    expect(res.counters.skipped_concurrent).toBe(1);
    expect(await stateOf(id)).toBe(changed);
    expect(await commits("space-c")).toBe(commitsBefore);
    // relance : le document est maintenant réécrit
    const again = await run({ apply: true, org: ORG_C, confirmDb: DB_NAME }, new ReportCls());
    expect(statusOf(again, id)).toBe("rewritten");
    expect(await contentOf(id)).toContain(`/api/media/${M_C}`);
  });

  it("échec d'écriture disque sur un état partiellement résolu : markdown_stale, la relance resynchronise", async () => {
    const id = docs.disk;
    const k = (n: string) => `/api/attachments/${SP_C}/${n}`;
    await seedDoc({
      id, spaceId: SP_C, orgId: ORG_C,
      ydoc: docOf(el("image", { src: k("c.png") }), el("image", { src: k("jamais-trouve.png") })),
    });
    const file = join(ROOT, "space-c", `${id}.md`);
    const original = readFileSync(file, "utf8");
    const res = await run({ apply: true, org: ORG_C, confirmDb: DB_NAME }, new ReportCls(), {
      // le fichier devient un dossier après la lecture : l'écriture échoue même sous root
      beforeWrite: async (docId) => {
        if (docId !== id) return;
        rmSync(file);
        mkdirSync(file);
      },
    });
    expect(statusOf(res, id)).toBe("markdown_stale");
    rmSync(file, { recursive: true });
    writeFileSync(file, original, "utf8");
    // la clé résolue est réécrite, la clé introuvable reste (I1 : elle ne bloque plus le rattrapage)
    expect(collectKeys(decode(await stateOf(id)))).toEqual([`${SP_C}/jamais-trouve.png`]);
    expect(readFileSync(file, "utf8")).toContain("/api/attachments/");
    const commitsBefore = await commits("space-c");
    const fixed = await run({ apply: true, org: ORG_C, confirmDb: DB_NAME }, new ReportCls());
    expect(statusOf(fixed, id)).toBe("resynced");
    const md = extractText(decode(await stateOf(id)));
    expect(readFileSync(file, "utf8")).toBe(md);
    expect(md).toContain(`/api/media/${M_C}`);
    expect(await contentOf(id)).toBe(md);
    expect(await commits("space-c")).toBe(commitsBefore + 1);
    // troisième passe : zéro écriture
    const before = await snapshot();
    const third = await run({ apply: true, org: ORG_C, confirmDb: DB_NAME }, new ReportCls());
    expect(statusOf(third, id)).toBe("skip_clean");
    expect(await snapshot()).toBe(before);
  });

  describe("organisation D (espaces, divergence disque, dépôt absent)", () => {
    const runD = (apply = true) => run({ apply, org: ORG_D, confirmDb: DB_NAME }, new ReportCls());
    const kd = (space: string, n: string) => `/api/attachments/${space}/${n}`;

    it("visibilité des clés : même espace et espace d'organisation non secret seulement", async () => {
      const id = randomUUID();
      await seedDoc({
        id, spaceId: SP_D, orgId: ORG_D,
        ydoc: docOf(
          el("image", { src: kd(SP_D, "d1.png") }),
          el("image", { src: kd(SP_D_ORGWIDE, "wide.png") }),
          el("image", { src: kd(SP_D_SECRET, "sec.png") }),
          el("image", { src: kd(SP_D_OTHER, "other.png") }),
          el("image", { src: `/api/attachments/nospace/${ORG_D}/n.png` }),
        ),
      });
      const res = await runD();
      expect(statusOf(res, id)).toBe("rewritten");
      const md = extractText(decode(await stateOf(id)));
      expect(md).toContain(`/api/media/${M_D1}`);
      expect(md).toContain(`/api/media/${M_D_ORGWIDE}`);
      for (const m of [M_D_SECRET, M_D_OTHER, M_D_NOSPACE]) expect(md).not.toContain(m);
      expect(collectKeys(decode(await stateOf(id))).sort()).toEqual(
        [`${SP_D_OTHER}/other.png`, `${SP_D_SECRET}/sec.png`, `nospace/${ORG_D}/n.png`].sort(),
      );
    });

    it("fichier disque plus riche que l'état régénéré (tableau) : disk_diverged, rien écrit", async () => {
      const id = randomUUID();
      const rich = `| H1 | H2 |\n|---|---|\n| a | b |\n\n![x](${kd(SP_D, "d1.png")})\n`;
      await seedDoc({
        id, spaceId: SP_D, orgId: ORG_D,
        ydoc: docOf(el("image", { src: kd(SP_D, "d1.png") })),
        markdown: rich,
      });
      const before = await snapshot(ORG_D);
      const stateBefore = await stateOf(id);
      const logs = await commits("space-d");
      const res = await runD();
      expect(statusOf(res, id)).toBe("disk_diverged");
      expect(res.counters.disk_diverged).toBeGreaterThanOrEqual(1);
      expect(await stateOf(id)).toBe(stateBefore);
      expect(await contentOf(id)).toBe(rich);
      expect(fileOf(id, "space-d")).toBe(rich);
      expect(await commits("space-d")).toBe(logs);
      expect(await snapshot(ORG_D)).toBe(before);
    });

    it("fichier écrit par l'ancien convertisseur (images absentes) : réécrit, image et URL résolue dans le disque", async () => {
      const id = randomUUID();
      const ydoc = docOf(para(["Bonjour"]), el("image", { src: kd(SP_D, "d1.png"), alt: "a" }));
      const legacy = extractText(ydoc, { images: false });
      expect(legacy).not.toContain("![");
      await seedDoc({ id, spaceId: SP_D, orgId: ORG_D, ydoc, markdown: legacy });
      const logs = await commits("space-d");
      const res = await runD();
      expect(statusOf(res, id)).toBe("rewritten");
      const md = extractText(decode(await stateOf(id)));
      expect(md).toContain(`![a](/api/media/${M_D1})`);
      expect(fileOf(id, "space-d")).toBe(md);
      expect(await contentOf(id)).toBe(md);
      expect(await commits("space-d")).toBe(logs + 1);
    });

    it("fichier écrit par un autre convertisseur (structure riche) : disk_diverged malgré une image", async () => {
      const id = randomUUID();
      const ydoc = docOf(para(["Bonjour"]), el("image", { src: kd(SP_D, "d1.png") }));
      const foreign = `| H1 | H2 |\n|---|---|\n| a | b |\n\nBonjour\n`;
      await seedDoc({ id, spaceId: SP_D, orgId: ORG_D, ydoc, markdown: foreign });
      const stateBefore = await stateOf(id);
      const res = await runD();
      expect(statusOf(res, id)).toBe("disk_diverged");
      expect(await stateOf(id)).toBe(stateBefore);
      expect(fileOf(id, "space-d")).toBe(foreign);
    });

    it("content_text égal à l'état mais fichier différent : disk_diverged", async () => {
      const id = randomUUID();
      const ydoc = docOf(el("image", { src: kd(SP_D, "d1.png") }));
      await seedDoc({ id, spaceId: SP_D, orgId: ORG_D, ydoc });
      writeFileSync(join(ROOT, "space-d", `${id}.md`), "autre contenu écrit en dernier\n", "utf8");
      const res = await runD();
      expect(statusOf(res, id)).toBe("disk_diverged");
      expect(collectKeys(decode(await stateOf(id)))).toEqual([`${SP_D}/d1.png`]);
    });

    it("dépôt ou fichier absent : error, aucune création de dépôt ni d'écriture", async () => {
      const noRepo = randomUUID();
      const noFile = randomUUID();
      await q(
        `insert into documents (id, space_id, title, slug, file_path, created_by, content_text, updated_at)
         values ($1,$2,'t','t',$3,$4,'x','2020-01-01')`,
        [noRepo, SP_D_NOREPO, `${noRepo}.md`, USER],
      );
      await q("insert into document_collab_states (document_id, yjs_state, updated_at) values ($1,$2, now() - interval '120 minutes')", [
        noRepo, b64(docOf(el("image", { src: kd(SP_D_NOREPO, "x.png") }))),
      ]);
      await seedDoc({ id: noFile, spaceId: SP_D, orgId: ORG_D, ydoc: docOf(el("image", { src: kd(SP_D, "d1.png") })) });
      rmSync(join(ROOT, "space-d", `${noFile}.md`));
      const stateBefore = await stateOf(noFile);
      const res = await runD();
      expect(statusOf(res, noRepo)).toBe("error");
      expect(statusOf(res, noFile)).toBe("error");
      expect(existsSync(join(ROOT, "space-norepo"))).toBe(false);
      expect(existsSync(join(ROOT, "space-d", `${noFile}.md`))).toBe(false);
      expect(await stateOf(noFile)).toBe(stateBefore);
    });

    it("deuxième exécution après tout cela : zéro écriture et zéro commit", async () => {
      const before = await snapshot(ORG_D);
      const logs = await commits("space-d");
      await runD();
      expect(await snapshot(ORG_D)).toBe(before);
      expect(await commits("space-d")).toBe(logs);
    });
  });
});
