import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { setupCrmFixture } from "@/lib/crm/__tests__/crm-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown, permission: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: (...a: unknown[]) => h.permission(...a),
}));
vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn() }));

import {
  resolveFicheContext,
  ensureDossierForMail,
  ensureInteractionTypeOption,
  writeMailInteraction,
  CrmDisconnectedError,
  CrmTraceForbiddenError,
} from "../crm-trace";
import type { MailMessageRow } from "@/lib/db/schema-mailing";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("crm-trace (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const SP_A = randomUUID();
  const SP_A_IX = randomUUID();
  const SP_B = randomUUID();
  const USER = randomUUID();
  const levels: Record<string, PermissionLevel | null> = {};
  let contacts: string, dossiers: string, interactions: string, foreign: string;
  const col: Record<string, string> = {};

  async function newDb(spaceId: string, name: string) {
    const id = randomUUID();
    await fx.pool.query("INSERT INTO user_databases (id, space_id, name) VALUES ($1,$2,$3)", [id, spaceId, name]);
    return id;
  }
  async function newCol(dbId: string, name: string, type: string, config: object = {}) {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, config) VALUES ($1,$2,$3,$4) RETURNING id",
      [dbId, name, type, JSON.stringify(config)],
    );
    return rows[0].id as string;
  }
  async function newRow(dbId: string, cells: object, updatedAt?: string) {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells, updated_at) VALUES ($1,$2,COALESCE($3::timestamptz, now())) RETURNING id",
      [dbId, JSON.stringify(cells), updatedAt ?? null],
    );
    return rows[0].id as string;
  }
  async function cellsOf(rowId: string) {
    const { rows } = await fx.pool.query("SELECT cells FROM user_database_rows WHERE id=$1", [rowId]);
    return rows[0]?.cells as Record<string, unknown>;
  }
  async function connect(fieldMapPatch: Record<string, Record<string, string | null>> = {}) {
    const fieldMap = {
      contacts: { nom: col.cNom, email: col.cMail },
      dossiers: { titre: col.dTitre, statut: col.dStatut, contact: col.dContact },
      interactions: {
        date: col.iDate, type: col.iType, dossier: col.iDossier, contact: col.iContact,
        sens: col.iSens, intitule: col.iTitre, compte_rendu: col.iNotes, pieces: col.iPieces,
      },
      ...fieldMapPatch,
    };
    await fx.pool.query("DELETE FROM crm_connections WHERE organization_id=$1", [ORG_A]);
    await fx.pool.query(
      `INSERT INTO crm_connections (organization_id, enabled, contacts_database_id, deals_database_id,
        interactions_database_id, field_map) VALUES ($1,true,$2,$3,$4,$5)`,
      [ORG_A, contacts, dossiers, interactions, JSON.stringify(fieldMap)],
    );
  }
  async function newMail(over: Partial<MailMessageRow> = {}): Promise<MailMessageRow> {
    const id = randomUUID();
    await fx.pool.query("INSERT INTO mail_messages (id, organization_id) VALUES ($1,$2)", [id, ORG_A]);
    return {
      id, organizationId: ORG_A, userId: USER, direction: "out", subject: "Devis mars",
      bodyText: "Bonjour Claire,\nVoici le devis.", sentAt: new Date("2026-11-18T10:00:00Z"),
      createdAt: new Date("2026-11-18T09:59:00Z"), attachments: [], interactionRowId: null,
      contactRowId: null, dossierRowId: null, ...over,
    } as MailMessageRow;
  }

  let claire: string;
  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_mailing_trace");
    h.db = fx.db;
    await fx.pool.query(`CREATE TABLE mail_messages (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
      interaction_row_id uuid, updated_at timestamptz NOT NULL DEFAULT now())`);
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'a','A'),($2,'b','B')", [ORG_A, ORG_B]);
    await fx.pool.query(
      "INSERT INTO spaces (id, organization_id, name) VALUES ($1,$4,'A'),($2,$4,'Interactions'),($3,$5,'B')",
      [SP_A, SP_A_IX, SP_B, ORG_A, ORG_B],
    );
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
    contacts = await newDb(SP_A, "Contacts");
    dossiers = await newDb(SP_A, "Dossiers");
    interactions = await newDb(SP_A_IX, "Interactions");
    foreign = await newDb(SP_B, "Étrangère");
    col.cNom = await newCol(contacts, "Nom", "text");
    col.cMail = await newCol(contacts, "Mail", "email");
    col.dTitre = await newCol(dossiers, "Titre", "text");
    col.dStatut = await newCol(dossiers, "Statut", "select", { options: ["Nouveau", "Gagné"] });
    col.dContact = await newCol(dossiers, "Contact", "relation", { targetDatabaseId: contacts });
    col.iDate = await newCol(interactions, "Date", "date");
    col.iType = await newCol(interactions, "Type", "select", { options: ["Appel"] });
    col.iDossier = await newCol(interactions, "Dossier", "relation", { targetDatabaseId: dossiers });
    col.iContact = await newCol(interactions, "Contact", "relation", { targetDatabaseId: contacts });
    col.iSens = await newCol(interactions, "Sens", "select", { options: [] });
    col.iTitre = await newCol(interactions, "Intitulé", "text");
    col.iNotes = await newCol(interactions, "Compte rendu", "text");
    col.iPieces = await newCol(interactions, "Pièces", "attachment");
    await newCol(foreign, "Nom", "text");
    col.fSel = await newCol(foreign, "Type", "select", { options: ["X"] });
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    h.permission.mockReset();
    h.permission.mockImplementation(async (u: string, s: string) => levels[`${u}:${s}`] ?? null);
    levels[`${USER}:${SP_A}`] = "editor";
    levels[`${USER}:${SP_A_IX}`] = "editor";
    await fx.pool.query("DELETE FROM user_database_rows");
    await fx.pool.query("DELETE FROM mail_messages");
    await fx.pool.query(
      "UPDATE user_database_columns SET config = $2 WHERE id = $1",
      [col.iType, JSON.stringify({ options: ["Appel"] })],
    );
    await fx.pool.query(
      "UPDATE user_database_columns SET config = $2 WHERE id = $1",
      [col.iSens, JSON.stringify({ options: [] })],
    );
    await connect();
    claire = await newRow(contacts, { [col.cNom]: "Claire Martin", [col.cMail]: "claire@ex.fr" });
  });

  describe("resolveFicheContext", () => {
    it("returns null for a database that is not a CRM role", async () => {
      const row = await newRow(foreign, {});
      expect(await resolveFicheContext(ORG_A, USER, { databaseId: foreign, rowId: row })).toBeNull();
    });

    it("returns null when the row belongs to another database", async () => {
      expect(await resolveFicheContext(ORG_A, USER, { databaseId: dossiers, rowId: claire })).toBeNull();
      expect(await resolveFicheContext(ORG_A, USER, { databaseId: contacts, rowId: randomUUID() })).toBeNull();
    });

    it("returns null for another organization", async () => {
      expect(await resolveFicheContext(ORG_B, USER, { databaseId: contacts, rowId: claire })).toBeNull();
    });

    it("returns null when the space is not readable by the user", async () => {
      levels[`${USER}:${SP_A}`] = null as never;
      expect(await resolveFicheContext(ORG_A, USER, { databaseId: contacts, rowId: claire })).toBeNull();
    });

    it("resolves a contact row with its name, email and no dossier", async () => {
      const ctx = await resolveFicheContext(ORG_A, USER, { databaseId: contacts, rowId: claire });
      expect(ctx).toMatchObject({
        role: "contacts", contactRowId: claire, contactDatabaseId: contacts,
        contactEmail: "claire@ex.fr", contactName: "Claire Martin",
        dossiers: [], defaultDossierRowId: null, fixedDossierRowId: null,
      });
    });

    it("lists dossiers newest first and defaults to the most recently modified", async () => {
      const old = await newRow(dossiers, { [col.dTitre]: "Ancien", [col.dContact]: [claire] }, "2026-01-01T00:00:00Z");
      const recent = await newRow(dossiers, { [col.dTitre]: "Récent", [col.dContact]: [claire] }, "2026-06-01T00:00:00Z");
      await newRow(dossiers, { [col.dTitre]: "Autre", [col.dContact]: [randomUUID()] });
      const ctx = await resolveFicheContext(ORG_A, USER, { databaseId: contacts, rowId: claire });
      expect(ctx?.dossiers.map((d) => d.rowId)).toEqual([recent, old]);
      expect(ctx?.dossiers[0]).toMatchObject({ title: "Récent" });
      expect(ctx?.defaultDossierRowId).toBe(recent);
      expect(ctx?.fixedDossierRowId).toBeNull();
    });

    it("from a dossier row resolves its contact and fixes the dossier", async () => {
      const d = await newRow(dossiers, { [col.dTitre]: "Projet", [col.dContact]: [claire] });
      await newRow(dossiers, { [col.dTitre]: "Autre", [col.dContact]: [claire] }, "2030-01-01T00:00:00Z");
      const ctx = await resolveFicheContext(ORG_A, USER, { databaseId: dossiers, rowId: d });
      expect(ctx).toMatchObject({ role: "dossiers", contactRowId: claire, contactEmail: "claire@ex.fr" });
      expect(ctx?.fixedDossierRowId).toBe(d);
      expect(ctx?.defaultDossierRowId).toBe(d);
    });

    it("returns null for a dossier without contact", async () => {
      const d = await newRow(dossiers, { [col.dTitre]: "Orphelin" });
      expect(await resolveFicheContext(ORG_A, USER, { databaseId: dossiers, rowId: d })).toBeNull();
    });
  });

  describe("ensureDossierForMail", () => {
    const tctx = () => ({ orgId: ORG_A, userId: USER });

    it('creates "Contact entrant : Claire Martin" linked to the contact when none exists', async () => {
      const r = await ensureDossierForMail(tctx(), { contactRowId: claire });
      expect(r.created).toBe(true);
      const cells = await cellsOf(r.dossierRowId);
      expect(cells[col.dTitre]).toBe("Contact entrant : Claire Martin");
      expect(cells[col.dStatut]).toBe("Nouveau");
      expect(cells[col.dContact]).toEqual([claire]);
    });

    it("falls back to the contact email in the title when the contact has no name", async () => {
      const anon = await newRow(contacts, { [col.cMail]: "anon@ex.fr" });
      const r = await ensureDossierForMail(tctx(), { contactRowId: anon });
      expect((await cellsOf(r.dossierRowId))[col.dTitre]).toBe("Contact entrant : anon@ex.fr");
    });

    it("creates only one dossier under concurrent calls", async () => {
      const rs = await Promise.all([1, 2, 3].map(() => ensureDossierForMail(tctx(), { contactRowId: claire })));
      expect(new Set(rs.map((r) => r.dossierRowId)).size).toBe(1);
      expect(rs.filter((r) => r.created)).toHaveLength(1);
    });

    it("reuses the only dossier", async () => {
      const d = await newRow(dossiers, { [col.dTitre]: "Projet", [col.dContact]: [claire] });
      expect(await ensureDossierForMail(tctx(), { contactRowId: claire })).toEqual({ dossierRowId: d, created: false });
    });

    it("picks the most recently modified dossier when several exist and none is given", async () => {
      await newRow(dossiers, { [col.dTitre]: "Ancien", [col.dContact]: [claire] }, "2026-01-01T00:00:00Z");
      const recent = await newRow(dossiers, { [col.dTitre]: "Récent", [col.dContact]: [claire] }, "2026-06-01T00:00:00Z");
      expect((await ensureDossierForMail(tctx(), { contactRowId: claire })).dossierRowId).toBe(recent);
    });

    it("accepts an explicit dossier of the contact", async () => {
      const a = await newRow(dossiers, { [col.dTitre]: "A", [col.dContact]: [claire] });
      await newRow(dossiers, { [col.dTitre]: "B", [col.dContact]: [claire] }, "2030-01-01T00:00:00Z");
      expect(await ensureDossierForMail(tctx(), { contactRowId: claire, dossierRowId: a })).toEqual({
        dossierRowId: a, created: false,
      });
    });

    it("rejects a dossier of another contact", async () => {
      const other = await newRow(contacts, { [col.cNom]: "Paul" });
      const d = await newRow(dossiers, { [col.dTitre]: "Paul", [col.dContact]: [other] });
      await expect(ensureDossierForMail(tctx(), { contactRowId: claire, dossierRowId: d })).rejects.toThrow();
    });

    it("falls back to the automatic dossier when the chosen dossier was deleted before the trace", async () => {
      const chosen = await newRow(dossiers, { [col.dTitre]: "Choisi", [col.dContact]: [claire] });
      await fx.pool.query("DELETE FROM user_database_rows WHERE id=$1", [chosen]);
      const r = await ensureDossierForMail(tctx(), { contactRowId: claire, dossierRowId: chosen });
      expect(r.dossierRowId).not.toBe(chosen);
      expect(await cellsOf(r.dossierRowId)).toMatchObject({ [col.dContact]: [claire] });
    });

    it("rejects a contact row that does not exist in the contacts database", async () => {
      await expect(ensureDossierForMail(tctx(), { contactRowId: randomUUID() })).rejects.toThrow();
    });

    it("refuses to create a dossier when the user only has viewer permission", async () => {
      levels[`${USER}:${SP_A}`] = "viewer";
      await expect(ensureDossierForMail(tctx(), { contactRowId: claire })).rejects.toBeInstanceOf(CrmTraceForbiddenError);
    });

    it("returns an existing dossier to a viewer without writing", async () => {
      const d = await newRow(dossiers, { [col.dTitre]: "Projet", [col.dContact]: [claire] });
      levels[`${USER}:${SP_A}`] = "viewer";
      expect(await ensureDossierForMail(tctx(), { contactRowId: claire })).toEqual({ dossierRowId: d, created: false });
    });
  });

  describe("ensureInteractionTypeOption", () => {
    async function options() {
      const { rows } = await fx.pool.query("SELECT config FROM user_database_columns WHERE id=$1", [col.iType]);
      return rows[0].config.options as string[];
    }

    it("adds the option once under concurrent calls", async () => {
      await Promise.all(
        [1, 2, 3, 4].map(() => ensureInteractionTypeOption(ORG_A, interactions, col.iType, "Mail envoyé")),
      );
      expect(await options()).toEqual(["Appel", "Mail envoyé"]);
    });

    it("keeps existing options and adds the second label", async () => {
      await ensureInteractionTypeOption(ORG_A, interactions, col.iType, "Mail envoyé");
      await ensureInteractionTypeOption(ORG_A, interactions, col.iType, "Mail reçu");
      expect(await options()).toEqual(["Appel", "Mail envoyé", "Mail reçu"]);
    });

    it("does not touch a column of another database", async () => {
      await expect(ensureInteractionTypeOption(ORG_B, foreign, col.iType, "Mail envoyé")).rejects.toThrow();
      expect(await options()).toEqual(["Appel"]);
    });

    it("refuses a column of a database of another organization and leaves it unchanged", async () => {
      await expect(ensureInteractionTypeOption(ORG_B, interactions, col.iType, "Mail envoyé")).rejects.toThrow();
      await expect(ensureInteractionTypeOption(ORG_A, foreign, col.fSel, "Mail envoyé")).rejects.toThrow();
      expect(await options()).toEqual(["Appel"]);
      const { rows } = await fx.pool.query("SELECT config FROM user_database_columns WHERE id=$1", [col.fSel]);
      expect(rows[0].config.options).toEqual(["X"]);
    });
  });

  describe("writeMailInteraction", () => {
    async function fixtureMail(over: Partial<MailMessageRow> = {}) {
      const d = await newRow(dossiers, { [col.dTitre]: "Projet", [col.dContact]: [claire] });
      const m = await newMail({ contactRowId: claire, dossierRowId: d, ...over });
      return { m, d };
    }

    it('writes type "Mail envoyé" with dossier relation set', async () => {
      const { m, d } = await fixtureMail({
        attachments: [
          { source: "upload", storageKey: "k/devis.pdf", fileName: "devis.pdf", mimeType: "application/pdf", size: 12 },
        ],
      });
      const { interactionRowId } = await writeMailInteraction(m);
      const cells = await cellsOf(interactionRowId);
      expect(cells[col.iType]).toBe("Mail envoyé");
      expect(cells[col.iDossier]).toEqual([d]);
      expect(cells[col.iContact]).toEqual([claire]);
      expect(cells[col.iSens]).toBe("Sortant");
      expect(cells[col.iTitre]).toBe("Devis mars");
      expect(cells[col.iNotes]).toContain("Voici le devis.");
      expect(String(cells[col.iDate])).toContain("2026-11-18");
      expect(cells[col.iPieces]).toEqual([
        { key: "k/devis.pdf", filename: "devis.pdf", mimeType: "application/pdf", size: 12 },
      ]);
      const { rows } = await fx.pool.query("SELECT interaction_row_id FROM mail_messages WHERE id=$1", [m.id]);
      expect(rows[0].interaction_row_id).toBe(interactionRowId);
    });

    it('writes "Mail reçu" and "Entrant" for an incoming message and adds the options', async () => {
      const { m } = await fixtureMail({ direction: "in" });
      const { interactionRowId } = await writeMailInteraction(m);
      const cells = await cellsOf(interactionRowId);
      expect(cells[col.iType]).toBe("Mail reçu");
      expect(cells[col.iSens]).toBe("Entrant");
    });

    it("records the history of the row as system source labelled Mailing with the real author", async () => {
      const { m } = await fixtureMail();
      const { interactionRowId } = await writeMailInteraction(m);
      const { rows } = await fx.pool.query(
        "SELECT source, actor_label, actor_user_id FROM database_row_changes WHERE row_id=$1 AND kind='created'",
        [interactionRowId],
      );
      expect(rows[0]).toMatchObject({ source: "system", actor_label: "Mailing", actor_user_id: USER });
    });

    it("is idempotent (second call returns the same row id)", async () => {
      const { m } = await fixtureMail();
      const a = await writeMailInteraction(m);
      const b = await writeMailInteraction(m);
      const c = await Promise.all([writeMailInteraction(m), writeMailInteraction(m)]);
      expect(b.interactionRowId).toBe(a.interactionRowId);
      expect(c.every((x) => x.interactionRowId === a.interactionRowId)).toBe(true);
      const { rows } = await fx.pool.query("SELECT count(*)::int n FROM user_database_rows WHERE database_id=$1", [interactions]);
      expect(rows[0].n).toBe(1);
    });

    it("refuses to write when the user only has viewer permission on the interactions space", async () => {
      levels[`${USER}:${SP_A_IX}`] = "viewer";
      const { m } = await fixtureMail();
      await expect(writeMailInteraction(m)).rejects.toBeInstanceOf(CrmTraceForbiddenError);
    });

    it("skips contact and sens when unmapped", async () => {
      await connect({
        interactions: { date: col.iDate, type: col.iType, dossier: col.iDossier, intitule: col.iTitre },
      });
      const { m } = await fixtureMail();
      const { interactionRowId } = await writeMailInteraction(m);
      const cells = await cellsOf(interactionRowId);
      expect(cells[col.iContact]).toBeUndefined();
      expect(cells[col.iSens]).toBeUndefined();
      expect(cells[col.iType]).toBe("Mail envoyé");
    });

    it("throws a typed CrmDisconnectedError when interactions database is not connected", async () => {
      await fx.pool.query("UPDATE crm_connections SET interactions_database_id = NULL WHERE organization_id=$1", [ORG_A]);
      const { m } = await fixtureMail();
      await expect(writeMailInteraction(m)).rejects.toBeInstanceOf(CrmDisconnectedError);
      const { rows } = await fx.pool.query("SELECT interaction_row_id FROM mail_messages WHERE id=$1", [m.id]);
      expect(rows[0].interaction_row_id).toBeNull();
    });

    it("rejects a contactRowId that is not in the contacts database, without writing", async () => {
      const { m } = await fixtureMail({ contactRowId: await newRow(foreign, {}) });
      await expect(writeMailInteraction(m)).rejects.toMatchObject({ code: "contact_not_found" });
      const { rows } = await fx.pool.query("SELECT count(*)::int n FROM user_database_rows WHERE database_id=$1", [interactions]);
      expect(rows[0].n).toBe(0);
    });

    it("rejects a dossier of another contact, without writing", async () => {
      const other = await newRow(contacts, { [col.cNom]: "Paul" });
      const d = await newRow(dossiers, { [col.dTitre]: "Paul", [col.dContact]: [other] });
      const { m } = await fixtureMail({ dossierRowId: d });
      await expect(writeMailInteraction(m)).rejects.toMatchObject({ code: "dossier_mismatch" });
      const { rows } = await fx.pool.query("SELECT count(*)::int n FROM user_database_rows WHERE database_id=$1", [interactions]);
      expect(rows[0].n).toBe(0);
    });

    it("throws when the message has no dossier", async () => {
      const { m } = await fixtureMail({ dossierRowId: null });
      await expect(writeMailInteraction(m)).rejects.toThrow();
    });
  });
});
