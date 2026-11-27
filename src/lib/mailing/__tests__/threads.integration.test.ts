import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupCrmFixture } from "@/lib/crm/__tests__/crm-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

import { listFicheMails, getVisibleMail } from "../threads";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("threads (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG = randomUUID();
  const ORG2 = randomUUID();
  const U1 = randomUUID();
  const U2 = randomUUID();
  const CONTACT = randomUUID();
  const DOSSIER_A = randomUUID();
  const DOSSIER_B = randomUUID();
  const acc: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const insert = async (key: string, org: string, user: string, contact: string | null, dossier: string | null) => {
    const id = randomUUID();
    ids[key] = id;
    await fx.pool.query(
      `INSERT INTO mail_messages (id, organization_id, account_id, user_id, direction, status, message_id, thread_key,
        from_address, subject, contact_row_id, dossier_row_id, client_key)
       VALUES ($1,$2,$3,$4,'out','sent',$5,$5,'me@x.fr',$6,$7,$8,$9)`,
      [id, org, acc[`${org}:${user}`], user, `<${id}@x>`, key, contact, dossier, randomUUID()],
    );
  };

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_mailing_threads");
    h.db = fx.db;
    for (const f of ["0061_mail_accounts.sql", "0062_mail_messages.sql", "0063_mail_trace_attempts.sql", "0064_mail_messages_account_set_null.sql"]) {
      await fx.pool.query(readFileSync(join(process.cwd(), "src/lib/db/migrations", f), "utf8"));
    }
    for (const o of [ORG, ORG2]) await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,$2,'O')", [o, o.slice(0, 8)]);
    for (const u of [U1, U2]) await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
    for (const [o, u] of [[ORG, U1], [ORG, U2], [ORG2, U1]]) {
      const id = randomUUID();
      acc[`${o}:${u}`] = id;
      await fx.pool.query(
        `INSERT INTO mail_accounts (id, organization_id, user_id, address, smtp_host, smtp_port, smtp_security,
          imap_host, imap_port, imap_security) VALUES ($1,$2,$3,$4,'s',465,'ssl','i',993,'ssl')`,
        [id, o, u, `${id}@x.fr`],
      );
    }
    await insert("own-a", ORG, U1, CONTACT, DOSSIER_A);
    await insert("own-b", ORG, U1, CONTACT, DOSSIER_B);
    await insert("colleague", ORG, U2, CONTACT, DOSSIER_A);
    await insert("other-org", ORG2, U1, CONTACT, DOSSIER_A);
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  const subjects = (rows: { subject: string }[]) => rows.map((r) => r.subject).sort();

  it("a contact fiche lists only the session user's mails of the session organization", async () => {
    expect(subjects(await listFicheMails(ORG, U1, { kind: "contact", contactRowId: CONTACT }))).toEqual(["own-a", "own-b"]);
  });
  it("a dossier fiche lists only that dossier's mails", async () => {
    expect(subjects(await listFicheMails(ORG, U1, { kind: "dossier", dossierRowId: DOSSIER_A }))).toEqual(["own-a"]);
  });
  it("never returns mail of another organization, even with the same row ids", async () => {
    expect(subjects(await listFicheMails(ORG2, U1, { kind: "dossier", dossierRowId: DOSSIER_A }))).toEqual(["other-org"]);
    expect(await listFicheMails(randomUUID(), U1, { kind: "contact", contactRowId: CONTACT })).toEqual([]);
  });
  it("getVisibleMail hides a colleague's mail and another organization's mail", async () => {
    expect(await getVisibleMail(ORG, U1, ids["own-a"])).not.toBeNull();
    expect(await getVisibleMail(ORG, U1, ids["colleague"])).toBeNull();
    expect(await getVisibleMail(ORG, U1, ids["other-org"])).toBeNull();
    expect(await getVisibleMail(ORG2, U1, ids["own-a"])).toBeNull();
  });

  it("getVisibleMail WHERE excludes another user, then another organization, and keeps the legitimate read", async () => {
    const id = ids["own-a"];
    expect(await getVisibleMail(ORG, U2, id)).toBeNull();
    expect(await getVisibleMail(ORG2, U1, id)).toBeNull();
    expect(await getVisibleMail(randomUUID(), randomUUID(), id)).toBeNull();
    const mine = await getVisibleMail(ORG, U1, id);
    expect(mine?.id).toBe(id);
    expect(mine?.organizationId).toBe(ORG);
    expect(mine?.userId).toBe(U1);
  });
});
