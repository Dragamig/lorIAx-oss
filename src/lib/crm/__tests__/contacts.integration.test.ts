import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";
import { loadCrmContext } from "../context";
import { loadContacts } from "../contacts";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("contacts (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_contacts");
    s = await seedCrmBases(fx);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  const load = async (user: string, search = "") => {
    const ctx = await loadCrmContext(s.orgA, user, s.deps);
    expect(ctx).not.toBeNull();
    return loadContacts(ctx!, { search }, s.deps);
  };
  const byName = (r: Awaited<ReturnType<typeof load>>, name: string) => r.contacts.find((c) => c.name === name)!;
  const cleanups: string[] = [];
  afterEach(async () => {
    for (const id of cleanups.splice(0)) await fx.pool.query("DELETE FROM user_database_rows WHERE id = $1", [id]);
  });
  const addContact = async (name: string, extra: object = {}) => {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,50) RETURNING id",
      [s.bases.contacts, JSON.stringify({ [s.col["contacts.nom"]]: name, ...extra })],
    );
    cleanups.push(rows[0].id);
    return rows[0].id as string;
  };

  it("dossiers ouverts et montant cumulé par contact", async () => {
    // Contact 1 : dossiers 1 (Prospect, 1000) et 5 (Perdu 5000, clos si vue ; sans vue tout est ouvert)
    const r = await load(s.editor);
    const c1 = byName(r, "Contact 1");
    expect(c1.openDeals).toBe(2);
    expect(c1.openAmount).toBe(6000);
    expect(r.columns.length).toBeGreaterThan(0);
    expect(c1.row.id).toBe(c1.id);
    expect(r.canEdit).toBe(true);
    expect(r.currency).toMatch(/^[A-Z]{3}$/);
  });

  it("dossier non chiffré compté mais sans montant", async () => {
    const cid = await addContact("Sans montant");
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,60) RETURNING id",
      [s.bases.dossiers, JSON.stringify({ [s.col["dossiers.titre"]]: "Nu", [s.col["dossiers.contact"]]: [cid] })],
    );
    cleanups.push(rows[0].id);
    const c = byName(await load(s.editor), "Sans montant");
    expect(c.openDeals).toBe(1);
    expect(c.openAmount).toBe(0);
  });

  it("contact sans dossier : 0 et 0, sans interaction, e-mail vide en null", async () => {
    await addContact("Seul", { [s.col["contacts.email"]]: "  " });
    const c = byName(await load(s.editor), "Seul");
    expect(c.openDeals).toBe(0);
    expect(c.openAmount).toBe(0);
    expect(c.lastInteraction).toBeNull();
    expect(c.email).toBeNull();
  });

  it("dossiers clos exclus (statuts clos de la vue Pipeline)", async () => {
    await fx.pool.query(
      "INSERT INTO user_database_views (database_id, name, type, scope, position, config) VALUES ($1,'Pipeline C','kanban','shared',7,$2)",
      [s.bases.dossiers, JSON.stringify({ kanbanTotals: { amountColumnId: "x", closedLanes: ["Signé", "Perdu"], weights: {}, showWeighted: false } })],
    );
    try {
      const c1 = byName(await load(s.editor), "Contact 1");
      expect(c1.openDeals).toBe(1);
      expect(c1.openAmount).toBe(1000);
    } finally {
      await fx.pool.query("DELETE FROM user_database_views WHERE name = 'Pipeline C'");
    }
  });

  it("dernière interaction : la plus récente parmi les dossiers du contact", async () => {
    const c1 = byName(await load(s.editor), "Contact 1");
    // dossiers 1 (interaction 2026-11-01) et 5 (2026-11-05)
    expect(c1.lastInteraction).toEqual({ date: "2026-11-05", type: "Appel", title: null });
  });

  it("recherche : % et _ littéraux, insensible à la casse", async () => {
    await addContact("Remise 50%");
    await addContact("A_B");
    await addContact("AxB");
    expect((await load(s.editor, "50%")).contacts.map((c) => c.name)).toEqual(["Remise 50%"]);
    expect((await load(s.editor, "a_b")).contacts.map((c) => c.name)).toEqual(["A_B"]);
    expect((await load(s.editor, "%")).contacts.map((c) => c.name)).toEqual(["Remise 50%"]);
    expect((await load(s.editor, "CONTACT 2")).contacts.map((c) => c.name)).toEqual(["Contact 2"]);
    expect((await load(s.editor, "c3@x")).contacts.map((c) => c.name)).toEqual(["Contact 3"]);
  });

  it("nom en formule : évalué à l'affichage et trouvé par la recherche", async () => {
    await fx.pool.query("UPDATE user_database_columns SET type = 'formula', config = $2 WHERE id = $1", [
      s.col["contacts.nom"],
      JSON.stringify({ formula: 'concat("Fiche ", prop("Mail"))' }),
    ]);
    try {
      const all = await load(s.editor);
      expect(all.contacts.map((c) => c.name)).toContain("Fiche c1@x.fr");
      const found = await load(s.editor, "fiche C2@");
      expect(found.contacts.map((c) => c.name)).toEqual(["Fiche c2@x.fr"]);
    } finally {
      await fx.pool.query("UPDATE user_database_columns SET type = 'text', config = '{}' WHERE id = $1", [s.col["contacts.nom"]]);
    }
  });

  it("viewer : canEdit false ; sans droit : contexte nul", async () => {
    expect((await load(s.viewer)).canEdit).toBe(false);
    expect(await loadCrmContext(s.orgA, s.outsider, s.deps)).toBeNull();
    expect(await loadCrmContext(s.orgB, s.editor, s.deps)).toBeNull();
  });
});
