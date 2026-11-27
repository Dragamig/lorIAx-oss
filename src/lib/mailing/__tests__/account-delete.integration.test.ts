import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupCrmFixture } from "@/lib/crm/__tests__/crm-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("../transport", () => ({ invalidateTransport: () => {} }));

import { deleteAccount } from "../accounts";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("suppression de la boîte (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG = randomUUID();
  const USER = randomUUID();
  const ACC = randomUUID();

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_mailing_acc_delete");
    h.db = fx.db;
    for (const f of ["0061_mail_accounts.sql", "0062_mail_messages.sql", "0063_mail_trace_attempts.sql", "0064_mail_messages_account_set_null.sql"]) {
      await fx.pool.query(readFileSync(join(process.cwd(), "src/lib/db/migrations", f), "utf8"));
    }
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'o','O')", [ORG]);
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
    await fx.pool.query(
      `INSERT INTO mail_accounts (id, organization_id, user_id, address, smtp_host, smtp_port, smtp_security,
        imap_host, imap_port, imap_security) VALUES ($1,$2,$3,'me@example.fr','smtp.example.fr',465,'ssl','imap.example.fr',993,'ssl')`,
      [ACC, ORG, USER],
    );
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  it("garde les mails et met account_id à NULL quand la boîte est supprimée", async () => {
    const id = randomUUID();
    await fx.pool.query(
      `INSERT INTO mail_messages (id, organization_id, account_id, user_id, direction, status, from_address, subject)
       VALUES ($1,$2,$3,$4,'out','sent','me@example.fr','Historique')`,
      [id, ORG, ACC, USER],
    );
    expect(await deleteAccount(ORG, USER)).toBe(true);
    const r = await fx.pool.query("SELECT account_id, subject FROM mail_messages WHERE id=$1", [id]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ account_id: null, subject: "Historique" });
  });

  it("la migration 0064 est idempotente", async () => {
    const sql = readFileSync(join(process.cwd(), "src/lib/db/migrations/0064_mail_messages_account_set_null.sql"), "utf8");
    await fx.pool.query(sql);
    await fx.pool.query(sql);
    const fk = await fx.pool.query(
      `SELECT confdeltype FROM pg_constraint WHERE conrelid='mail_messages'::regclass AND contype='f' AND confrelid='mail_accounts'::regclass`,
    );
    expect(fk.rows).toHaveLength(1);
    expect(fk.rows[0].confdeltype).toBe("n");
  });
});
