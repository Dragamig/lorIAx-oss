import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";
import { deriveCrmContext, loadCrmContext } from "../context";
import { loadDeal, listDealInteractions } from "../deals";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!URL)("deals (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_deals");
    s = await seedCrmBases(fx);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  const ctxOf = async (user: string) => {
    const ctx = await loadCrmContext(s.orgA, user, s.deps);
    expect(ctx).not.toBeNull();
    return ctx!;
  };
  const cleanups: string[] = [];
  afterEach(async () => {
    for (const id of cleanups.splice(0)) await fx.pool.query("DELETE FROM user_database_rows WHERE id = $1", [id]);
  });
  const addInteraction = async (dealId: string, date: string, position: number, title = "x") => {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,$3) RETURNING id",
      [
        s.bases.interactions,
        JSON.stringify({
          [s.col["interactions.date"]]: date,
          [s.col["interactions.type"]]: "Appel",
          [s.col["interactions.dossier"]]: [dealId],
          [s.col["interactions.intitule"]]: title,
        }),
        position,
      ],
    );
    cleanups.push(rows[0].id);
    return rows[0].id as string;
  };

  it("fiche d'un dossier : dossier, contact, ligne, colonnes, droits, options de type", async () => {
    const r = await loadDeal(await ctxOf(s.editor), s.dossierIds[0], s.deps);
    expect(r).not.toBeNull();
    expect(r!.deal.title).toBe("Dossier 1");
    expect(r!.deal.amount).toBe(1000);
    expect(r!.contact?.name).toBe("Contact 1");
    expect(r!.row.id).toBe(s.dossierIds[0]);
    expect(r!.columns.length).toBeGreaterThan(0);
    expect(r!.contactRow?.id).toBe(s.contactIds[0]);
    expect(r!.contactColumns.length).toBeGreaterThan(0);
    expect(r!.databaseId).toBe(s.bases.dossiers);
    expect(r!.spaceId).toBe(s.spaceA);
    expect(r!.canEdit).toBe(true);
    expect(Array.isArray(r!.interactionTypes)).toBe(true);
    expect(typeof r!.canLog).toBe("boolean");
    expect((await listDealInteractions(await ctxOf(s.editor), s.dossierIds[0], s.deps))!.map((i) => i.id)).toEqual([s.interactionIds[0]]);
  });

  it("canNote et canEditInteractions suivent le raccordement et le droit", async () => {
    const ctx = await ctxOf(s.editor);
    const base = await loadDeal(ctx, s.dossierIds[0], s.deps);
    expect(base!.canNote).toBe(ctx.fieldColumn("interactions", "compte_rendu") !== null);
    expect(base!.canEditInteractions).toBe(true);
    const noNote = deriveCrmContext(ctx, { fieldColumn: (r, k) => (k === "compte_rendu" ? null : ctx.fieldColumn(r, k)) });
    expect((await loadDeal(noNote, s.dossierIds[0], s.deps))!.canNote).toBe(false);
    const withNote = deriveCrmContext(ctx, { fieldColumn: (r, k) => (k === "compte_rendu" ? "col-x" : ctx.fieldColumn(r, k)) });
    expect((await loadDeal(withNote, s.dossierIds[0], s.deps))!.canNote).toBe(true);
    const ro = deriveCrmContext(ctx, { canEdit: () => false });
    expect((await loadDeal(ro, s.dossierIds[0], s.deps))!.canEditInteractions).toBe(false);
  });

  it("lecteur : canEdit faux", async () => {
    const r = await loadDeal(await ctxOf(s.viewer), s.dossierIds[0], s.deps);
    expect(r!.canEdit).toBe(false);
  });

  it("ligne de la base Contacts, uuid inexistant, non uuid : null", async () => {
    const ctx = await ctxOf(s.editor);
    expect(await loadDeal(ctx, s.contactIds[0], s.deps)).toBeNull();
    expect(await loadDeal(ctx, MISSING, s.deps)).toBeNull();
    expect(await loadDeal(ctx, "pas-un-uuid", s.deps)).toBeNull();
    expect(await listDealInteractions(ctx, s.contactIds[0], s.deps)).toBeNull();
    expect(await listDealInteractions(ctx, "pas-un-uuid", s.deps)).toBeNull();
  });

  it("ligne d'une autre organisation : null, identique à l'inexistant", async () => {
    const { rows } = await fx.pool.query("SELECT id FROM user_database_rows WHERE database_id = $1", [s.foreign.dossiers]);
    const ctx = await ctxOf(s.editor);
    const foreign = await loadDeal(ctx, rows[0].id, s.deps);
    const missing = await loadDeal(ctx, MISSING, s.deps);
    expect(foreign).toBeNull();
    expect(foreign).toEqual(missing);
    expect(await listDealInteractions(ctx, rows[0].id, s.deps)).toBeNull();
  });

  it("interactions du dossier, date décroissante puis position", async () => {
    const d = s.dossierIds[5];
    const a = await addInteraction(d, "2026-10-01", 10);
    const b = await addInteraction(d, "2026-10-03", 12);
    const c = await addInteraction(d, "2026-10-03", 11);
    const e = await addInteraction(d, "2026-10-02", 13);
    const ctx = await ctxOf(s.editor);
    const all = await listDealInteractions(ctx, d, s.deps);
    expect(all!.map((i) => i.id)).toEqual([c, b, e, a]);
  });

  it("interaction d'un autre dossier absente", async () => {
    const other = await addInteraction(s.dossierIds[2], "2026-10-09", 20);
    const ctx = await ctxOf(s.editor);
    const all = await listDealInteractions(ctx, s.dossierIds[0], s.deps);
    expect(all!.map((i) => i.id)).not.toContain(other);
    expect(all!.every((i) => i.dealId === s.dossierIds[0])).toBe(true);
  });

  it("dossier sans interaction : liste vide, pas null", async () => {
    const ctx = await ctxOf(s.editor);
    expect(await listDealInteractions(ctx, s.dossierIds[5], s.deps)).toEqual([]);
  });
});
