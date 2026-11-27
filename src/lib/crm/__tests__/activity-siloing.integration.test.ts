/**
 * Cloisonnement des mails du fil d'activité contre la vraie base : deux utilisateurs d'une même
 * organisation sur la même fiche ne voient chacun que leurs propres mails.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { setupMailingFixture, type CrmIds } from "@/lib/mailing/__tests__/support/mailing-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

import { loadActivityMails } from "../activity";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("cloisonnement des mails du fil d'activité (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupMailingFixture>>;
  let org: string, ua: string, ub: string;
  let crm: CrmIds;
  let claire: string;

  async function insertMail(userId: string, subject: string, status = "sent") {
    await fx.pool.query(
      `INSERT INTO mail_messages (organization_id, user_id, direction, status, from_address, to_addresses, subject, contact_database_id, contact_row_id)
       VALUES ($1,$2,'out',$3,'me@ex.fr',ARRAY['claire@ex.fr'],$4,$5,$6)`,
      [org, userId, status, subject, crm.contacts, claire],
    );
  }

  beforeAll(async () => {
    fx = await setupMailingFixture(URL!, "rh_activity_siloing");
    h.db = fx.db;
    await fx.newOrg("default", "1 day");
    org = await fx.newOrg("org-act");
    ua = await fx.newUser(org);
    ub = await fx.newUser(org);
    crm = await fx.newCrm(org, "A");
    claire = await fx.newRow(crm.contacts, { [crm.col.cNom]: "Claire Martin", [crm.col.cMail]: "claire@ex.fr" });
    await insertMail(ua, "De A");
    await insertMail(ua, "A annulé", "cancelled");
    await insertMail(ub, "De B");
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  it("chaque utilisateur ne voit que ses mails, annulés masqués", async () => {
    const scope = { kind: "contact", rowId: claire } as const;
    expect((await loadActivityMails(org, ua, scope)).map((m) => m.subject)).toEqual(["De A"]);
    expect((await loadActivityMails(org, ub, scope)).map((m) => m.subject)).toEqual(["De B"]);
  });
});
