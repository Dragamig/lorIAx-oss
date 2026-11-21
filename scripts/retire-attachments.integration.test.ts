/**
 * Archivage de attachments / studio_images (schéma legacy_archive, ici `<schéma>_arch`) contre une base de test dédiée, dans un schéma privé par cas
 * (schéma 1.204.0 recréé à chaque cas). Requiert MEDIA_TEST_DATABASE_URL (nom de base contenant "test").
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAttachmentsRetired, importArchivedMedia } from "./retire-attachments";

const URL_ = process.env.MEDIA_TEST_DATABASE_URL;
const DB_NAME = URL_ ? new URL(URL_).pathname.replace(/^\//, "") : "";
if (URL_ && !DB_NAME.includes("test")) {
  throw new Error(`MEDIA_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const DDL = `
  CREATE TABLE spaces (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
  CREATE TYPE media_kind AS ENUM ('image','pdf','document','video','audio','archive','other');
  CREATE TYPE media_origin AS ENUM ('upload','stock','automation','studio');
  CREATE TABLE media (id uuid PRIMARY KEY, organization_id uuid NOT NULL, space_id uuid, document_id uuid,
    filename varchar(500) NOT NULL DEFAULT 'f', mime_type varchar(255) NOT NULL DEFAULT 'application/octet-stream',
    kind media_kind NOT NULL DEFAULT 'other', origin media_origin NOT NULL DEFAULT 'upload', size_bytes bigint NOT NULL DEFAULT 0,
    storage_key text NOT NULL UNIQUE, uploaded_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
  CREATE TABLE attachments (id uuid PRIMARY KEY, document_id uuid, space_id uuid, filename varchar(500) NOT NULL DEFAULT 'f',
    mime_type varchar(255) NOT NULL DEFAULT 'application/octet-stream', size_bytes bigint NOT NULL DEFAULT 0, storage_key text NOT NULL,
    uploaded_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE studio_images (id uuid PRIMARY KEY, organization_id uuid NOT NULL, space_id uuid, name varchar(500) NOT NULL DEFAULT 'n',
    content_type varchar(255) NOT NULL DEFAULT 'image/png', size_bytes bigint, s3_key text NOT NULL,
    created_by uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION media_sync_from_attachments() RETURNS trigger AS $$
  BEGIN
    INSERT INTO media (id, organization_id, space_id, storage_key) VALUES (NEW.id, '00000000-0000-0000-0000-000000000001', NEW.space_id, NEW.storage_key) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;
  CREATE TRIGGER trg_attachments_to_media AFTER INSERT ON attachments FOR EACH ROW EXECUTE FUNCTION media_sync_from_attachments();
  CREATE FUNCTION media_sync_from_studio_images() RETURNS trigger AS $$
  BEGIN
    INSERT INTO media (id, organization_id, storage_key) VALUES (NEW.id, NEW.organization_id, NEW.s3_key) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;
  CREATE TRIGGER trg_studio_images_to_media AFTER INSERT ON studio_images FOR EACH ROW EXECUTE FUNCTION media_sync_from_studio_images();
`;

const ORG = "00000000-0000-0000-0000-000000000001";
const OTHER_ORG = "00000000-0000-0000-0000-000000000002";
const SPACE = "00000000-0000-0000-0000-0000000000a1";
const OTHER_SPACE = "00000000-0000-0000-0000-0000000000a2";

describe.skipIf(!URL_)("ensureAttachmentsRetired (base de test)", () => {
  let admin: Pool;
  let pool: Pool;
  let schema = "";
  let connectionString = "";

  beforeAll(() => {
    admin = new Pool({ connectionString: URL_ });
  });

  beforeEach(async () => {
    schema = `retire_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const u = new URL(URL_!);
    u.searchParams.set("options", `-c search_path=${schema}`);
    connectionString = u.toString();
    pool = new Pool({ connectionString });
    await pool.query(DDL);
    await pool.query("INSERT INTO spaces VALUES ($1,$2),($3,$4)", [SPACE, ORG, OTHER_SPACE, OTHER_ORG]);
    return async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS ${schema}_arch CASCADE`);
    };
  });

  afterAll(async () => {
    await admin.end();
  });

  const retire = () => ensureAttachmentsRetired(connectionString, { archiveSchema: `${schema}_arch` });
  const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  const exists = async (table: string) => (await pool.query("SELECT to_regclass($1) IS NOT NULL AS p", [table])).rows[0].p;
  const triggers = async () =>
    (await pool.query(`SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND NOT t.tgisinternal`, [schema])).rows.length;
  const functions = async () =>
    (await pool.query(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND proname LIKE 'media_sync_from_%'`, [schema])).rows.length;

  async function seedCopied() {
    const a1 = randomUUID();
    const a2 = randomUUID();
    const s1 = randomUUID();
    await pool.query("INSERT INTO attachments (id, space_id, storage_key) VALUES ($1, $3, 'k/a1'), ($2, $3, 'k/a2')", [a1, a2, SPACE]);
    await pool.query("INSERT INTO studio_images (id, organization_id, s3_key) VALUES ($1, $2, 's/s1')", [s1, ORG]);
    // La ligne media de a2 est soft-supprimée : compte comme copiée.
    await pool.query("UPDATE media SET deleted_at = now() WHERE id = $1", [a2]);
  }

  const archived = async (table: string) => (await pool.query(`SELECT to_regclass('${schema}_arch.${table}') IS NOT NULL AS p`)).rows[0].p;

  it("a. copie complète : tables archivées, déclencheurs et fonctions retirés, media intact, contenu archivé identique, rapport exact", async () => {
    await seedCopied();
    const before = await count("media");
    const original = (await pool.query("SELECT * FROM attachments ORDER BY id")).rows;
    const originalStudio = (await pool.query("SELECT * FROM studio_images ORDER BY id")).rows;
    const report = await retire();
    expect(report).toEqual({
      attachmentsSeen: 2,
      attachmentsCopied: 2,
      attachmentsDuplicates: 0,
      attachmentsOtherOrgKey: 0,
      attachmentsImported: 0,
      studioSeen: 1,
      studioCopied: 1,
      studioImported: 0,
      studioOrphansIgnored: 0,
      tablesArchived: ["attachments", "studio_images"],
      functionsDropped: ["media_sync_from_attachments", "media_sync_from_studio_images"],
    });
    expect(await exists("attachments")).toBe(false);
    expect(await exists("studio_images")).toBe(false);
    expect(await archived("attachments")).toBe(true);
    expect(await archived("studio_images")).toBe(true);
    expect((await pool.query(`SELECT * FROM ${schema}_arch.attachments ORDER BY id`)).rows).toEqual(original);
    expect((await pool.query(`SELECT * FROM ${schema}_arch.studio_images ORDER BY id`)).rows).toEqual(originalStudio);
    expect(await triggers()).toBe(0);
    expect(await functions()).toBe(0);
    expect(await count("media")).toBe(before);
  });

  it("b. attachments orpheline, espace introuvable donc non copiable : erreur nommant le nombre et un exemple, rien déplacé", async () => {
    await seedCopied();
    const orphan = randomUUID();
    await pool.query("ALTER TABLE attachments DISABLE TRIGGER USER");
    await pool.query("INSERT INTO attachments (id, space_id, storage_key) VALUES ($1, $2, 'k/orphan')", [orphan, randomUUID()]);
    await pool.query("ALTER TABLE attachments ENABLE TRIGGER USER");
    await expect(retire()).rejects.toThrow(new RegExp(`1 .*${orphan}`));
    expect(await exists("attachments")).toBe(true);
    expect(await exists("studio_images")).toBe(true);
    expect(await archived("attachments")).toBe(false);
    expect(await triggers()).toBe(2);
    expect(await functions()).toBe(2);
  });

  it("c. orpheline dont la clé existe sur un média de la même organisation : acceptée, comptée comme doublon", async () => {
    await seedCopied();
    const dup = randomUUID();
    await pool.query("INSERT INTO media (id, organization_id, storage_key) VALUES ($1, $2, 'k/shared')", [randomUUID(), ORG]);
    await pool.query("INSERT INTO attachments (id, space_id, storage_key) VALUES ($1, $2, 'k/shared')", [dup, SPACE]);
    const report = await retire();
    expect(report).toMatchObject({ attachmentsSeen: 3, attachmentsCopied: 3, attachmentsDuplicates: 1, attachmentsOtherOrgKey: 0 });
    expect(await archived("attachments")).toBe(true);
  });

  it("c2. clé portée seulement par une autre organisation : non bloquante, comptée à part", async () => {
    await seedCopied();
    await pool.query("INSERT INTO media (id, organization_id, storage_key) VALUES ($1, $2, 'k/foreign')", [randomUUID(), OTHER_ORG]);
    await pool.query("ALTER TABLE attachments DISABLE TRIGGER USER");
    await pool.query("INSERT INTO attachments (id, space_id, storage_key) VALUES ($1, $2, 'k/foreign')", [randomUUID(), SPACE]);
    const report = await retire();
    expect(report).toMatchObject({ attachmentsSeen: 3, attachmentsDuplicates: 0, attachmentsOtherOrgKey: 1 });
  });

  it("d. studio_images sans média de même id (image purgée) : non bloquante, comptée et archivée", async () => {
    await seedCopied();
    await pool.query("ALTER TABLE studio_images DISABLE TRIGGER USER");
    await pool.query("INSERT INTO studio_images (id, organization_id, s3_key) VALUES ($1, $2, 's/purged')", [randomUUID(), ORG]);
    const report = await retire();
    expect(report).toMatchObject({ studioSeen: 2, studioCopied: 1, studioOrphansIgnored: 1 });
    expect(await archived("studio_images")).toBe(true);
    expect(await count(`${schema}_arch.studio_images`)).toBe(2);
  });

  it("e. seconde exécution : null, aucun effet", async () => {
    await seedCopied();
    await retire();
    const before = await count("media");
    expect(await retire()).toBeNull();
    expect(await count("media")).toBe(before);
    expect(await count(`${schema}_arch.attachments`)).toBe(2);
  });

  it("e2. tables déjà dans l'archive : null ; une table présente dans les deux schémas : erreur explicite", async () => {
    await seedCopied();
    await retire();
    expect(await retire()).toBeNull();
    await pool.query("CREATE TABLE attachments (id uuid PRIMARY KEY, space_id uuid, storage_key text NOT NULL)");
    await expect(retire()).rejects.toThrow(/à la fois dans public et dans/);
    expect(await exists("attachments")).toBe(true);
  });

  it("f. base vide : null sans erreur", async () => {
    await pool.query("DROP TABLE attachments, studio_images CASCADE; DROP FUNCTION media_sync_from_attachments(); DROP FUNCTION media_sync_from_studio_images(); DROP TABLE media");
    expect(await retire()).toBeNull();
  });

  it("g. un INSERT fait avant l'étape est répercuté, plus aucun après : table publique et déclencheur disparus", async () => {
    const id = randomUUID();
    await pool.query("INSERT INTO attachments (id, space_id, storage_key) VALUES ($1, $2, 'k/g')", [id, SPACE]);
    expect(await count("media")).toBe(1);
    await retire();
    await expect(pool.query("INSERT INTO attachments (id, storage_key) VALUES ($1, 'k/g2')", [randomUUID()])).rejects.toThrow(/does not exist/);
    expect(await count("media")).toBe(1);
  });

  it("tolère l'absence de studio_images seule", async () => {
    await seedCopied();
    await pool.query("DROP TABLE studio_images CASCADE; DROP FUNCTION media_sync_from_studio_images()");
    const report = await retire();
    expect(report).toMatchObject({ attachmentsSeen: 2, studioSeen: 0, tablesArchived: ["attachments"] });
  });

  it("h. deux étapes simultanées : la seconde attend le verrou puis rend null", async () => {
    await seedCopied();
    const results = await Promise.all([retire(), retire()]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await exists("attachments")).toBe(false);
    expect(await archived("attachments")).toBe(true);
  });

  it("i. base sans media avec des lignes attachments (1.21.x) : archivées, puis importées dans media avec tous les champs, sans doublon à la relance", async () => {
    const id = randomUUID();
    const doc = randomUUID();
    const user = randomUUID();
    const created = "2026-03-04T05:06:07.000Z";
    await pool.query("ALTER TABLE attachments DISABLE TRIGGER USER");
    await pool.query(
      "INSERT INTO attachments (id, document_id, space_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at) VALUES ($1,$2,$3,'rapport.pdf','application/pdf',1234,$4,$5,$6)",
      [id, doc, SPACE, `${SPACE}/abc.pdf`, user, created],
    );
    await pool.query("DROP TABLE media CASCADE");
    const report = await retire();
    expect(report).toMatchObject({ attachmentsSeen: 1, attachmentsImported: 0 });
    expect(await archived("attachments")).toBe(true);
    // push de drizzle-kit : media est recréée
    await pool.query(`CREATE TABLE media (id uuid PRIMARY KEY, organization_id uuid NOT NULL, space_id uuid, document_id uuid,
      filename varchar(500) NOT NULL, mime_type varchar(255) NOT NULL, kind media_kind NOT NULL, origin media_origin NOT NULL DEFAULT 'upload',
      size_bytes bigint NOT NULL, storage_key text NOT NULL UNIQUE, uploaded_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)`);
    expect(await importArchivedMedia(connectionString, { archiveSchema: `${schema}_arch` })).toEqual({ attachments: 1, studio: 0 });
    const m = (await pool.query("SELECT * FROM media WHERE id = $1", [id])).rows[0];
    expect(m).toMatchObject({
      organization_id: ORG, space_id: SPACE, document_id: doc, filename: "rapport.pdf", mime_type: "application/pdf",
      kind: "pdf", origin: "upload", storage_key: `${SPACE}/abc.pdf`, uploaded_by: user,
    });
    expect(Number(m.size_bytes)).toBe(1234);
    expect(m.created_at.toISOString()).toBe(created);
    // Seconde exécution : rien copié deux fois, même si la ligne media a été supprimée entre-temps.
    await pool.query("DELETE FROM media WHERE id = $1", [id]);
    expect(await importArchivedMedia(connectionString, { archiveSchema: `${schema}_arch` })).toBeNull();
    expect(await count("media")).toBe(0);
    expect(await retire()).toBeNull();
  });

  it("i5. import sans media : une ligne sans espace n'est pas copiée, le journal compare vues et copiées et nomme l'identifiant ignoré", async () => {
    const good = randomUUID();
    const lost = randomUUID();
    const user = randomUUID();
    await pool.query("ALTER TABLE attachments DISABLE TRIGGER USER");
    for (const [id, space, key] of [[good, SPACE, "k-good.pdf"], [lost, randomUUID(), "k-lost.pdf"]]) {
      await pool.query(
        "INSERT INTO attachments (id, document_id, space_id, filename, mime_type, size_bytes, storage_key, uploaded_by) VALUES ($1,$2,$3,'f.pdf','application/pdf',1,$4,$5)",
        [id, randomUUID(), space, key, user],
      );
    }
    await pool.query("DROP TABLE media CASCADE");
    await retire();
    await pool.query(`CREATE TABLE media (id uuid PRIMARY KEY, organization_id uuid NOT NULL, space_id uuid, document_id uuid,
      filename varchar(500) NOT NULL, mime_type varchar(255) NOT NULL, kind media_kind NOT NULL, origin media_origin NOT NULL DEFAULT 'upload',
      size_bytes bigint NOT NULL, storage_key text NOT NULL UNIQUE, uploaded_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)`);
    const logs: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
    const warn = vi.spyOn(console, "warn").mockImplementation((m) => void logs.push(String(m)));
    try {
      expect(await importArchivedMedia(connectionString, { archiveSchema: `${schema}_arch` })).toEqual({ attachments: 1, studio: 0 });
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
    expect(logs.join("\n")).toContain("attachments : 2 lignes vues, 1 copiées vers media, 1 sans copie");
    expect(logs.join("\n")).toMatch(new RegExp(`Écart d'import.*1 ligne\\(s\\) non copiée.*${lost}`));
  });

  it("i3. base sans media avec attachments et studio_images : les deux sont importés, chacun une seule fois", async () => {
    const a = randomUUID();
    const si = randomUUID();
    await pool.query("ALTER TABLE attachments DISABLE TRIGGER USER");
    await pool.query("ALTER TABLE studio_images DISABLE TRIGGER USER");
    await pool.query("INSERT INTO attachments (id, space_id, storage_key) VALUES ($1,$2,'k/i3')", [a, SPACE]);
    await pool.query("INSERT INTO studio_images (id, organization_id, s3_key, size_bytes) VALUES ($1,$2,'s/i3',NULL)", [si, ORG]);
    await pool.query("DROP TABLE media CASCADE");
    await retire();
    await pool.query(`CREATE TABLE media (id uuid PRIMARY KEY, organization_id uuid NOT NULL, space_id uuid, document_id uuid,
      filename varchar(500) NOT NULL, mime_type varchar(255) NOT NULL, kind media_kind NOT NULL, origin media_origin NOT NULL DEFAULT 'upload',
      size_bytes bigint NOT NULL, storage_key text NOT NULL UNIQUE, uploaded_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)`);
    expect(await importArchivedMedia(connectionString, { archiveSchema: `${schema}_arch` })).toEqual({ attachments: 1, studio: 1 });
    expect((await pool.query("SELECT origin, kind, size_bytes FROM media WHERE id = $1", [si])).rows[0]).toMatchObject({ origin: "studio", kind: "image" });
    expect(await importArchivedMedia(connectionString, { archiveSchema: `${schema}_arch` })).toBeNull();
    expect(await count("media")).toBe(2);
  });

  it("i4. media présente mais ligne attachments non copiée : copiée dans la transaction d'archivage", async () => {
    const id = randomUUID();
    await pool.query("ALTER TABLE attachments DISABLE TRIGGER USER");
    await pool.query("INSERT INTO attachments (id, space_id, storage_key, mime_type) VALUES ($1,$2,'k/i4','image/png')", [id, SPACE]);
    const report = await retire();
    expect(report).toMatchObject({ attachmentsSeen: 1, attachmentsCopied: 1, attachmentsImported: 1 });
    expect((await pool.query("SELECT kind FROM media WHERE id = $1", [id])).rows[0].kind).toBe("image");
    expect(await archived("attachments")).toBe(true);
  });

  it("i2. base sans media et sans aucune ligne legacy (1.21.x publique vide) : tables archivées, sans erreur", async () => {
    await pool.query("DROP TABLE media CASCADE");
    const report = await retire();
    expect(report).toMatchObject({ attachmentsSeen: 0, studioSeen: 0 });
    expect(await exists("attachments")).toBe(false);
    expect(await archived("attachments")).toBe(true);
  });

  it("j. les clés étrangères sortantes sont retirées de l'archive : un utilisateur référencé reste supprimable", async () => {
    await pool.query("CREATE TABLE users (id uuid PRIMARY KEY)");
    await pool.query("ALTER TABLE attachments ADD CONSTRAINT fk_att_user FOREIGN KEY (uploaded_by) REFERENCES users(id)");
    const u = randomUUID();
    await pool.query("INSERT INTO users VALUES ($1)", [u]);
    await pool.query("ALTER TABLE attachments DISABLE TRIGGER USER");
    const a = randomUUID();
    await pool.query("INSERT INTO attachments (id, space_id, storage_key, uploaded_by) VALUES ($1,$2,'k/j',$3)", [a, SPACE, u]);
    await pool.query("INSERT INTO media (id, organization_id, space_id, storage_key) VALUES ($1,$2,$3,'k/j')", [a, ORG, SPACE]);
    await retire();
    await pool.query("DELETE FROM users WHERE id = $1", [u]);
    expect(await count(`${schema}_arch.attachments`)).toBe(1);
  });
});
