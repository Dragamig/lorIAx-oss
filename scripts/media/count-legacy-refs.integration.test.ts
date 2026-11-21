/**
 * Exécution réelle de count-legacy-refs contre une base de test dédiée, dans un schéma privé.
 * Requiert MEDIA_TEST_DATABASE_URL (base dont le nom contient "test") ; ignoré sinon.
 */
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import * as Y from "yjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countLegacyRefs } from "./count-legacy-refs";
import { Report } from "./lib/report";

const URL_ = process.env.MEDIA_TEST_DATABASE_URL;
const DB_NAME = URL_ ? new URL(URL_).pathname.replace(/^\//, "") : "";
if (URL_ && !DB_NAME.includes("test")) {
  throw new Error(`MEDIA_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const DDL = (withLegacy: boolean) => `
  CREATE TABLE spaces (id uuid PRIMARY KEY, organization_id uuid NOT NULL, type text NOT NULL DEFAULT 'organization', classification text);
  CREATE TABLE documents (id uuid PRIMARY KEY, space_id uuid NOT NULL, content_text text);
  CREATE TABLE document_collab_states (document_id uuid PRIMARY KEY, yjs_state text NOT NULL);
  CREATE TABLE user_databases (id uuid PRIMARY KEY, space_id uuid NOT NULL);
  CREATE TABLE user_database_columns (id text PRIMARY KEY, database_id uuid NOT NULL, type text NOT NULL, position int NOT NULL DEFAULT 0);
  CREATE TABLE user_database_rows (id uuid PRIMARY KEY, database_id uuid NOT NULL, cells jsonb NOT NULL);
  CREATE TABLE video_projects (id uuid PRIMARY KEY, space_id uuid NOT NULL, timeline_json jsonb NOT NULL);
  CREATE TABLE brand_kits (id uuid PRIMARY KEY, organization_id uuid NOT NULL, logos jsonb NOT NULL);
  CREATE TABLE media (id uuid PRIMARY KEY, organization_id uuid NOT NULL, space_id uuid, storage_key text NOT NULL UNIQUE, deleted_at timestamptz);
  ${withLegacy ? `
  CREATE TABLE attachments (id uuid PRIMARY KEY, space_id uuid, storage_key text NOT NULL);
  CREATE TABLE studio_images (id uuid PRIMARY KEY, organization_id uuid NOT NULL, s3_key text NOT NULL);` : ""}
`;

const b64 = (setup: (frag: Y.XmlFragment) => void): string => {
  const d = new Y.Doc();
  setup(d.getXmlFragment("default"));
  return Buffer.from(Y.encodeStateAsUpdate(d)).toString("base64");
};

describe.skipIf(!URL_)("count-legacy-refs (base de test)", () => {
  let admin: Pool;
  const pools: Pool[] = [];
  const schemas = ["clr_full", "clr_ok", "clr_gone"];
  const ORG = randomUUID();
  const OTHER_ORG = randomUUID();
  const SPACE = randomUUID();
  const OTHER_SPACE = randomUUID();
  const mk = async (schema: string) => {
    const p = new Pool({ connectionString: URL_, options: `-c search_path=${schema}` });
    pools.push(p);
    return p;
  };

  async function seedMedia(p: Pool) {
    await p.query("insert into spaces (id, organization_id) values ($1,$2),($3,$4)", [SPACE, ORG, OTHER_SPACE, OTHER_ORG]);
    await p.query("insert into media values ($1,$2,$3,'sp/a.png',null)", [randomUUID(), ORG, SPACE]);
    await p.query("insert into media values ($1,$2,$3,'sp/other-org.png',null)", [randomUUID(), OTHER_ORG, OTHER_SPACE]);
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: URL_ });
    for (const s of schemas) {
      await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
      await admin.query(`CREATE SCHEMA ${s}`);
    }
  });

  afterAll(async () => {
    for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => {});
    await admin.end();
    await Promise.all(pools.map((p) => p.end()));
  });

  describe("jeu complet avec orphelins", () => {
    let pool: Pool;
    const D1 = randomUUID();
    const IDS = { byId: randomUUID(), byKey: randomUUID(), orphan: randomUUID(), softDeleted: randomUUID(), studioOk: randomUUID(), studioOrphan: randomUUID() };
    const fingerprint = async () => {
      const parts: unknown[] = [];
      for (const t of ["media", "documents", "document_collab_states", "user_database_rows", "video_projects", "brand_kits", "attachments", "studio_images"]) {
        parts.push((await pool.query(`select * from ${t} order by 1`)).rows);
      }
      return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
    };

    beforeAll(async () => {
      pool = await mk("clr_full");
      await pool.query(DDL(true));
      await seedMedia(pool);
      // Copies : par id, par clé seule, orpheline, soft-supprimée de même id.
      await pool.query("insert into media values ($1,$2,$3,'sp/byid.png',null)", [IDS.byId, ORG, SPACE]);
      await pool.query("insert into media values ($1,$2,$3,'sp/shared.png',null)", [randomUUID(), ORG, SPACE]);
      await pool.query("insert into media values ($1,$2,$3,'sp/gone.png',now())", [IDS.softDeleted, ORG, SPACE]);
      await pool.query("insert into media values ($1,$2,$3,'studio/ok',null)", [IDS.studioOk, ORG, SPACE]);
      await pool.query("insert into attachments values ($1,$2,'sp/byid.png'),($3,$2,'sp/shared.png'),($4,$2,'sp/lost.png'),($5,$2,'sp/gone.png'),($6,$2,'sp/other-org.png')", [
        IDS.byId, SPACE, IDS.byKey, IDS.orphan, IDS.softDeleted, randomUUID(),
      ]);
      await pool.query("insert into studio_images values ($1,$2,'studio/ok'),($3,$2,'studio/shared.png')", [IDS.studioOk, ORG, IDS.studioOrphan]);
      // Références dans chaque surface.
      await pool.query("insert into documents values ($1,$2,$3)", [
        D1, SPACE, "![a](/api/attachments/sp/a.png) ![x](/api/attachments/sp/other-org.png) ![n](/api/media/y)",
      ]);
      await pool.query("insert into document_collab_states values ($1,$2)", [
        D1,
        b64((f) => {
          const img = new Y.XmlElement("image");
          img.setAttribute("src", "/api/attachments/sp/a.png");
          const des = new Y.XmlElement("designBlock");
          des.setAttribute("thumbnailUrl", "/api/attachments/sp/nothumb.png");
          f.insert(0, [img, des]);
        }),
      ]);
      const DB = randomUUID();
      await pool.query("insert into user_databases values ($1,$2)", [DB, SPACE]);
      await pool.query("insert into user_database_columns values ('ci',$1,'image',0),('ca',$1,'attachment',1)", [DB]);
      await pool.query("insert into user_database_rows values ($1,$2,$3::jsonb)", [
        randomUUID(), DB, JSON.stringify({ ci: "/api/attachments/sp/a.png", ca: [{ key: "sp/missing.pdf" }, { mediaId: "m" }] }),
      ]);
      await pool.query("insert into video_projects values ($1,$2,$3::jsonb)", [
        randomUUID(), SPACE, JSON.stringify({ tracks: [{ clips: [{ sourceKey: "sp/a.png" }, { sourceKey: "sp/a.png", mediaId: "m" }] }] }),
      ]);
      await pool.query("insert into brand_kits values ($1,$2,$3::jsonb)", [
        randomUUID(), ORG, JSON.stringify([{ url: "/api/attachments/sp/a.png", name: "l" }]),
      ]);
    });

    it("mesure la copie, compte les références par surface, sort 2, sans écrire", async () => {
      const before = await fingerprint();
      const report = new Report();
      const r = await countLegacyRefs(pool, { apply: false, reportPath: "x" }, report);
      expect(await fingerprint()).toBe(before);
      expect(r.exitCode).toBe(2);
      expect(r.attachments).toEqual({ total: 5, copied_by_id: 2, copied_by_key: 1, copied_by_key_other_org: 1, orphan_unreachable: 1 });
      expect(r.studioImages).toEqual({ total: 2, copied_by_id: 1, copied_by_key: 0, copied_by_key_other_org: 0, orphan_unreachable: 1 });
      expect(r.references.content_text).toEqual({ resolvable: 1, missing: 1, ambiguous: 0, rows: 1 });
      expect(r.references.yjs_state).toEqual({ resolvable: 1, missing: 1, ambiguous: 0, rows: 1 });
      expect(r.references.design_thumbnail).toEqual({ resolvable: 0, missing: 1, ambiguous: 0, rows: 1 });
      expect(r.references.cells).toEqual({ resolvable: 1, missing: 1, ambiguous: 0, rows: 1 });
      expect(r.references.timeline).toEqual({ resolvable: 1, missing: 0, ambiguous: 0, rows: 1 });
      expect(r.references.brand_logo).toEqual({ resolvable: 1, missing: 0, ambiguous: 0, rows: 1 });
      expect(report.summary()["copy:attachments"].orphan).toBe(1);
      expect(report.summary()["copy:studio_images"].orphan).toBe(1);
    });

    it("la session est en lecture seule : une écriture y échouerait", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await expect(client.query("delete from media")).rejects.toThrow(/read-only/i);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("filtre par organisation : l'autre organisation ne voit rien", async () => {
      const r = await countLegacyRefs(pool, { apply: false, reportPath: "x", org: OTHER_ORG }, new Report());
      expect(r.references.content_text.rows).toBe(0);
      expect(r.attachments).toMatchObject({ total: 0 });
    });
  });

  it("sans orpheline inaccessible : sortie 0", async () => {
    const pool = await mk("clr_ok");
    await pool.query(DDL(true));
    await seedMedia(pool);
    const id = randomUUID();
    await pool.query("insert into media values ($1,$2,$3,'sp/x.png',null)", [id, ORG, SPACE]);
    await pool.query("insert into attachments values ($1,$2,'sp/x.png')", [id, SPACE]);
    const r = await countLegacyRefs(pool, { apply: false, reportPath: "x" }, new Report());
    expect(r.exitCode).toBe(0);
    expect(r.attachments).toMatchObject({ total: 1, copied_by_id: 1 });
    expect(r.studioImages).toMatchObject({ total: 0 });
  });

  it("studio_images orpheline seule : comptée, sortie 0", async () => {
    const pool = await mk("clr_ok");
    await pool.query("drop table attachments; drop table studio_images");
    await pool.query("create table attachments (id uuid primary key, space_id uuid, storage_key text not null); create table studio_images (id uuid primary key, organization_id uuid not null, s3_key text not null)");
    await pool.query("insert into studio_images values ($1,$2,'studio/purged')", [randomUUID(), ORG]);
    const r = await countLegacyRefs(pool, { apply: false, reportPath: "x" }, new Report());
    expect(r.exitCode).toBe(0);
    expect(r.studioImages).toMatchObject({ total: 1, orphan_unreachable: 1 });
  });

  it("table attachments absente : rapport « table déjà retirée », sortie 0", async () => {
    const pool = await mk("clr_gone");
    await pool.query(DDL(false));
    await seedMedia(pool);
    const r = await countLegacyRefs(pool, { apply: false, reportPath: "x" }, new Report());
    expect(r.exitCode).toBe(0);
    expect(r.attachments).toBe("table_retiree");
    expect(r.studioImages).toBe("table_retiree");
  });
});
