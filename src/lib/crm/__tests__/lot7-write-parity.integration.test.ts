/**
 * Parité d'écriture entre les routes CRM et les routes génériques des Bases (spec 11.2), contre la
 * vraie base (schéma rh_l7_write_parity). Les routes sont appelées pour de vrai : CRM
 * (relance, interactions, pipeline, relances) et génériques (PATCH/POST rows, GET base). Seuls la
 * session, le juge de permission d'espace et le dispatch d'automatismes sont simulés.
 * L'organisation A est l'organisation par défaut : les routes génériques résolvent l'organisation
 * sans requête (`headers()` hors portée de requête), donc sans en-tête `x-org-slug`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { PermissionLevel } from "@/types";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  user: { id: "", globalRole: "viewer" },
  levels: {} as Record<string, Record<string, PermissionLevel>>,
  dispatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ ...h.user, name: "T", email: "t@x.fr" })),
}));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: async (userId: string, spaceId: string) => h.levels[userId]?.[spaceId] ?? null,
}));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: vi.fn(async () => true) }));
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: h.dispatch }));

import { POST as relancePOST } from "@/app/api/crm/deals/[rowId]/relance/route";
import { POST as interactionsPOST } from "@/app/api/crm/deals/[rowId]/interactions/route";
import { GET as pipelineGET } from "@/app/api/crm/pipeline/route";
import { GET as relancesGET } from "@/app/api/crm/relances/route";
import { PATCH as rowsPATCH, POST as rowsPOST } from "@/app/api/databases/[databaseId]/rows/route";
import { GET as databaseGET } from "@/app/api/databases/[databaseId]/route";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const withRow = (rowId: string) => ({ params: Promise.resolve({ rowId }) });
const withDb = (databaseId: string) => ({ params: Promise.resolve({ databaseId }) });

describe.skipIf(!URL)("parité d'écriture CRM et Bases (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;
  let twinCol: string;
  let origRows: { id: string; cells: unknown }[];

  const json = (method: string, path: string, body?: unknown) =>
    new NextRequest(`http://x${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  /** Base lue par la route générique `GET /api/databases/[databaseId]`. */
  async function genericRead(databaseId: string) {
    const res = await databaseGET(json("GET", `/api/databases/${databaseId}`), withDb(databaseId));
    expect(res.status).toBe(200);
    return (await res.json()) as { rows: { id: string; cells: Record<string, unknown> }[] };
  }
  const cellsOf = async (databaseId: string, rowId: string) => {
    const row = (await genericRead(databaseId)).rows.find((r) => r.id === rowId);
    expect(row, rowId).toBeDefined();
    return row!.cells;
  };
  const xmin = async (table: "user_database_rows" | "database_row_changes", col: "id" | "row_id", id: string) =>
    (await fx.pool.query(`SELECT xmin::text AS x FROM ${table} WHERE ${col} = $1 ORDER BY created_at`, [id])).rows.map((r) => r.x as string);
  const changesOf = async (rowId: string) =>
    (await fx.pool.query("SELECT database_id, kind, source, actor_user_id, changes FROM database_row_changes WHERE row_id = $1 ORDER BY created_at, id", [rowId])).rows;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_write_parity", { tasks: true });
    h.db = fx.db;
    await fx.pool.query(`
      ALTER TABLE organizations
        ADD COLUMN is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE user_databases
        ADD COLUMN IF NOT EXISTS group_id uuid,
        ADD COLUMN IF NOT EXISTS description text,
        ADD COLUMN IF NOT EXISTS icon varchar(64),
        ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS created_by uuid,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);
    s = await seedCrmBases(fx);
    h.levels = s.levels;
    await fx.pool.query("UPDATE organizations SET created_at = now() - interval '1 day' WHERE id = $1", [s.orgA]);
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["interactions.type"],
      JSON.stringify({ options: ["Appel", "Mail"] }),
    ]);
    // Relation jumelée Dossier <-> Interactions.
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, position, config) VALUES ($1,'Interactions','relation',9,$2) RETURNING id",
      [s.bases.dossiers, JSON.stringify({ targetDatabaseId: s.bases.interactions, inverseColumnId: s.col["interactions.dossier"] })],
    );
    twinCol = rows[0].id;
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["interactions.dossier"],
      JSON.stringify({ targetDatabaseId: s.bases.dossiers, inverseColumnId: twinCol }),
    ]);
    origRows = (await fx.pool.query("SELECT id, cells FROM user_database_rows")).rows;
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  beforeEach(async () => {
    h.user = { id: s.editor, globalRole: "viewer" };
    // Etat partagé remis à zéro avant chaque test : lignes d'origine, aucune ligne ajoutée, aucun historique.
    for (const r of origRows) await fx.pool.query("UPDATE user_database_rows SET cells = $2 WHERE id = $1", [r.id, JSON.stringify(r.cells)]);
    await fx.pool.query("DELETE FROM user_database_rows WHERE id <> ALL($1::uuid[])", [origRows.map((r) => r.id)]);
    await fx.pool.query("DELETE FROM database_row_changes");
    h.dispatch.mockClear();
  });

  it("relance : cellules identiques à un PATCH générique, même historique, même transaction, un seul automatisme", async () => {
    const date = inDays(30);
    const col = s.col["dossiers.relance"];
    const [crmId, genId] = [s.dossierIds[0], s.dossierIds[1]];

    const crm = await relancePOST(json("POST", `/api/crm/deals/${crmId}/relance`, { date }), withRow(crmId));
    expect(crm.status).toBe(200);
    expect(await crm.json()).toEqual({ relance: date });
    const crmDispatch = h.dispatch.mock.calls.map((c) => c[0]);
    h.dispatch.mockClear();

    const gen = await rowsPATCH(json("PATCH", `/api/databases/${s.bases.dossiers}/rows`, { rows: [{ id: genId, cells: { [col]: date } }] }), withDb(s.bases.dossiers));
    expect(gen.status).toBe(200);
    const genDispatch = h.dispatch.mock.calls.map((c) => c[0]);

    // Lecture par la lecture générique : cellules identiques, hors titre.
    const a = await cellsOf(s.bases.dossiers, crmId);
    const b = await cellsOf(s.bases.dossiers, genId);
    expect(a[col]).toBe(date);
    expect(b[col]).toBe(date);
    const strip = (c: Record<string, unknown>) => {
      const { [s.col["dossiers.titre"]]: _t, [s.col["dossiers.contact"]]: _c, [s.col["dossiers.responsable"]]: _r, [s.col["dossiers.statut"]]: _s, [s.col["dossiers.montant"]]: _m, ...rest } = c;
      return rest;
    };
    expect(strip(a)).toEqual(strip(b));

    // Historique : une entrée, mêmes champs, source ui, acteur identique, contenu du changement identique.
    const hc = await changesOf(crmId);
    const hg = await changesOf(genId);
    expect(hc).toHaveLength(1);
    expect(hg).toHaveLength(1);
    expect(hc[0]).toEqual(hg[0]);
    expect(hc[0]).toMatchObject({ kind: "updated", source: "ui", actor_user_id: s.editor, database_id: s.bases.dossiers });

    // Même transaction : la ligne et son entrée d'historique portent le même xmin.
    for (const id of [crmId, genId]) {
      const rowX = await xmin("user_database_rows", "id", id);
      const chX = await xmin("database_row_changes", "row_id", id);
      expect(chX).toEqual(rowX);
    }

    // Automatisme row_updated déclenché autant de fois, mêmes arguments structurels.
    expect(crmDispatch).toHaveLength(1);
    expect(genDispatch).toHaveLength(1);
    expect(crmDispatch[0].databaseId).toBe(genDispatch[0].databaseId);
    expect(crmDispatch[0].before[col] ?? null).toBe(genDispatch[0].before[col] ?? null);
    expect(crmDispatch[0].after[col]).toBe(genDispatch[0].after[col]);
  });

  it("relance : idempotente comme le générique (valeur inchangée, aucune entrée ni automatisme)", async () => {
    const date = inDays(30);
    const id = s.dossierIds[0];
    await relancePOST(json("POST", `/api/crm/deals/${id}/relance`, { date }), withRow(id));
    h.dispatch.mockClear();
    await fx.pool.query("DELETE FROM database_row_changes");
    const again = await relancePOST(json("POST", `/api/crm/deals/${id}/relance`, { date }), withRow(id));
    expect(again.status).toBe(200);
    expect(await changesOf(id)).toHaveLength(0);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("interaction : mêmes cellules qu'une création générique, relation jumelée synchronisée, même transaction, un seul automatisme", async () => {
    const [crmDeal, genDeal] = [s.dossierIds[0], s.dossierIds[1]];
    const values = { date: "2026-11-19", type: "Appel", title: "Parité", note: "Compte rendu" };
    const crm = await interactionsPOST(json("POST", `/api/crm/deals/${crmDeal}/interactions`, values), withRow(crmDeal));
    expect(crm.status).toBe(201);
    const crmId = (await crm.json()).interaction.id as string;
    const crmDispatch = h.dispatch.mock.calls.map((c) => c[0]);
    h.dispatch.mockClear();

    const gen = await rowsPOST(
      json("POST", `/api/databases/${s.bases.interactions}/rows`, {
        cells: {
          [s.col["interactions.date"]]: values.date,
          [s.col["interactions.type"]]: values.type,
          [s.col["interactions.dossier"]]: [genDeal],
          [s.col["interactions.intitule"]]: values.title,
          [s.col["interactions.compte_rendu"]]: values.note,
        },
      }),
      withDb(s.bases.interactions),
    );
    expect(gen.status).toBe(201);
    const genId = (await gen.json()).id as string;
    const genDispatch = h.dispatch.mock.calls.map((c) => c[0]);

    // Lecture générique : cellules de l'interaction identiques hors relation, relation vers le bon dossier.
    const a = await cellsOf(s.bases.interactions, crmId);
    const b = await cellsOf(s.bases.interactions, genId);
    const dossierCol = s.col["interactions.dossier"];
    expect(a[dossierCol]).toEqual([crmDeal]);
    expect(b[dossierCol]).toEqual([genDeal]);
    const { [dossierCol]: _a, ...restA } = a;
    const { [dossierCol]: _b, ...restB } = b;
    expect(restA).toEqual(restB);

    // Relation jumelée : l'inverse du dossier porte l'interaction, de la même façon.
    expect((await cellsOf(s.bases.dossiers, crmDeal))[twinCol]).toEqual([crmId]);
    expect((await cellsOf(s.bases.dossiers, genDeal))[twinCol]).toEqual([genId]);

    // Historique : mêmes entrées (clef, source, base) pour la ligne créée et le dossier jumelé.
    const shape = async (rows: string[]) =>
      (await Promise.all(rows.map(changesOf))).flat().map((r) => `${r.kind}:${r.source}:${r.database_id}`).sort();
    expect(await shape([crmId, crmDeal])).toEqual(await shape([genId, genDeal]));
    expect((await changesOf(crmId))[0]).toMatchObject({ kind: "created", source: "ui", actor_user_id: s.editor, database_id: s.bases.interactions });

    // Même transaction : interaction, dossier jumelé et historique portent le même xmin.
    for (const [row, deal] of [[crmId, crmDeal], [genId, genDeal]]) {
      const [rowX] = await xmin("user_database_rows", "id", row);
      expect(await xmin("user_database_rows", "id", deal)).toEqual([rowX]);
      expect(await xmin("database_row_changes", "row_id", row)).toEqual([rowX]);
      expect(await xmin("database_row_changes", "row_id", deal)).toContain(rowX);
    }

    // Automatisme row_created : une fois chacun, avant nul, mêmes cellules.
    expect(crmDispatch).toHaveLength(1);
    expect(genDispatch).toHaveLength(1);
    expect(crmDispatch[0].before).toBeNull();
    expect(genDispatch[0].before).toBeNull();
    expect(crmDispatch[0].databaseId).toBe(genDispatch[0].databaseId);
    const stripDossier = (c: Record<string, unknown>) => {
      const { [dossierCol]: _x, ...rest } = c;
      return rest;
    };
    expect(stripDossier(crmDispatch[0].after)).toEqual(stripDossier(genDispatch[0].after));
  });

  it("inverse : un PATCH générique de statut, montant et relance est visible sans délai dans pipeline et relances", async () => {
    const id = s.dossierIds[2];
    const date = inDays(3);
    const res = await rowsPATCH(
      json("PATCH", `/api/databases/${s.bases.dossiers}/rows`, {
        rows: [{ id, cells: { [s.col["dossiers.statut"]]: "Devis", [s.col["dossiers.montant"]]: 98765, [s.col["dossiers.relance"]]: date } }],
      }),
      withDb(s.bases.dossiers),
    );
    expect(res.status).toBe(200);

    const pipe = await (await pipelineGET(json("GET", "/api/crm/pipeline"))).json();
    const deal = pipe.deals.find((d: { id: string }) => d.id === id);
    expect(deal).toMatchObject({ status: "Devis", amount: 98765, relance: date });

    const rel = await (await relancesGET(json("GET", "/api/crm/relances?horizon=31"))).json();
    const all = [...rel.groups.late, ...rel.groups.today, ...rel.groups.week] as { dealId: string; relance: string }[];
    expect(all.find((i) => i.dealId === id)?.relance).toBe(date);

    // Puis un second PATCH : la valeur remplace la précédente au prochain appel.
    await rowsPATCH(
      json("PATCH", `/api/databases/${s.bases.dossiers}/rows`, { rows: [{ id, cells: { [s.col["dossiers.montant"]]: 1 } }] }),
      withDb(s.bases.dossiers),
    );
    const pipe2 = await (await pipelineGET(json("GET", "/api/crm/pipeline"))).json();
    expect(pipe2.deals.find((d: { id: string }) => d.id === id).amount).toBe(1);
  });

  it("une relance posée par la route CRM est visible dans la file des relances", async () => {
    const id = s.dossierIds[0];
    const date = inDays(2);
    await relancePOST(json("POST", `/api/crm/deals/${id}/relance`, { date }), withRow(id));
    const rel = await (await relancesGET(json("GET", "/api/crm/relances?horizon=31"))).json();
    const all = [...rel.groups.late, ...rel.groups.today, ...rel.groups.week] as { dealId: string }[];
    expect(all.some((i) => i.dealId === id)).toBe(true);
  });
});
