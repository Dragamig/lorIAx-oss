import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupCrmFixture } from "@/lib/crm/__tests__/crm-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../attachments", () => ({ resolveAttachments: async () => [] }));
vi.mock("../quota", () => ({
  checkMailQuota: async () => ({ ok: true }),
  peekMailQuota: async () => ({ exceeded: false, limit: null }),
}));
const t = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }));
vi.mock("../transport", () => ({ getTransport: () => ({ sendMail: t.sendMail }), appendToSent: async () => true, invalidateTransport: () => {} }));
vi.mock("../crm-trace", () => ({
  resolveFicheContext: async () => ({
    role: "contacts", contactRowId: randomUUID(), contactDatabaseId: randomUUID(), contactEmail: null, contactName: "C",
    dossiers: [], defaultDossierRowId: null, fixedDossierRowId: null,
  }),
  ensureDossierForMail: async () => ({ dossierRowId: randomUUID(), created: false }),
  writeMailInteraction: async () => ({ interactionRowId: randomUUID() }),
}));

import { scheduleMail, claimDue, cancelScheduled, deliver, processDue } from "../outbox";
import type { MailMessageRow } from "@/lib/db/schema-mailing";
import type { ComposeInput } from "../compose";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("outbox (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG = randomUUID();
  const USER = randomUUID();
  const ACC = randomUUID();

  const compose = (clientKey = randomUUID()) =>
    ({
      clientKey, databaseId: randomUUID(), rowId: randomUUID(), to: ["c@x.fr"], cc: [], bcc: [],
      subject: "Bonjour", bodyHtml: "<p>Salut</p>", attachments: [],
    }) as ComposeInput;
  const send = (c: ComposeInput) => scheduleMail({ orgId: ORG, userId: USER, compose: c, ctx: {} as never });
  const count = async (where = "true") =>
    Number((await fx.pool.query(`SELECT count(*)::int AS n FROM mail_messages WHERE ${where}`)).rows[0].n);

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_mailing_outbox");
    h.db = fx.db;
    for (const f of ["0061_mail_accounts.sql", "0062_mail_messages.sql", "0063_mail_trace_attempts.sql", "0064_mail_messages_account_set_null.sql"]) {
      await fx.pool.query(readFileSync(join(process.cwd(), "src/lib/db/migrations", f), "utf8"));
    }
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'o','O')", [ORG]);
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
    await fx.pool.query(
      `INSERT INTO mail_accounts (id, organization_id, user_id, address, smtp_host, smtp_port, smtp_security,
        imap_host, imap_port, imap_security, cancel_delay_seconds, status) VALUES ($1,$2,$3,'me@example.fr','smtp.example.fr',465,'ssl','imap.example.fr',993,'ssl',30,'ok')`,
      [ACC, ORG, USER],
    );
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM mail_messages");
    t.sendMail.mockReset();
    t.sendMail.mockImplementation(async () => ({}));
  });

  it("two concurrent claimDue calls return disjoint sets", async () => {
    for (let i = 0; i < 6; i++) await send(compose());
    await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second'");
    const [a, b] = await Promise.all([claimDue(4), claimDue(4)]);
    const ids = [...a, ...b].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(6);
    expect([...a, ...b].every((m) => m.status === "sending" && m.attempts === 1)).toBe(true);
  });

  it("a double scheduleMail with the same client key creates one row", async () => {
    const key = randomUUID();
    const [x, y] = await Promise.all([send(compose(key)), send(compose(key))]);
    expect(x.rowId).toBe(y.rowId);
    expect(await count()).toBe(1);
  });

  it("claimDue never returns a cancelled or future mail", async () => {
    const cancelled = await send(compose());
    await cancelScheduled(ORG, USER, cancelled.rowId);
    await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second' WHERE id = $1", [cancelled.rowId]);
    await send(compose());
    expect(await claimDue(10)).toHaveLength(0);
  });

  it("cancelScheduled with another user or another organization leaves the row scheduled", async () => {
    const m = await send(compose());
    const status = async () => (await fx.pool.query("SELECT status FROM mail_messages WHERE id=$1", [m.rowId])).rows[0].status;
    expect(await cancelScheduled(ORG, randomUUID(), m.rowId)).toBe(false);
    expect(await cancelScheduled(randomUUID(), USER, m.rowId)).toBe(false);
    expect(await status()).toBe("scheduled");
    expect(await cancelScheduled(ORG, USER, m.rowId)).toBe(true);
    expect(await status()).toBe("cancelled");
  });

  it("cancel racing claimDue has exactly one winner", async () => {
    for (let i = 0; i < 5; i++) {
      await fx.pool.query("DELETE FROM mail_messages");
      const m = await send(compose());
      await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second' WHERE id=$1", [m.rowId]);
      const [cancelled, claimed] = await Promise.all([cancelScheduled(ORG, USER, m.rowId), claimDue(5)]);
      expect(Number(cancelled) + claimed.length).toBe(1);
    }
  });

  it("deliver with an account of another organization sends nothing", async () => {
    const ORG2 = randomUUID();
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'o2','O2')", [ORG2]);
    const id = randomUUID();
    await fx.pool.query(
      `INSERT INTO mail_messages (id, organization_id, account_id, user_id, direction, status, from_address, subject, attempts)
       VALUES ($1,$2,$3,$4,'out','sending','me@example.fr','x',1)`,
      [id, ORG2, ACC, USER],
    );
    const row = (await fx.pool.query("SELECT * FROM mail_messages WHERE id=$1", [id])).rows[0];
    t.sendMail.mockClear();
    await deliver({ id, organizationId: ORG2, accountId: ACC, userId: USER, toAddresses: [], ccAddresses: [], bccAddresses: [], references: [], attachments: [], subject: row.subject } as unknown as MailMessageRow);
    expect(t.sendMail).not.toHaveBeenCalled();
    expect((await fx.pool.query("SELECT status FROM mail_messages WHERE id=$1", [id])).rows[0].status).toBe("failed");
  });

  it("processDue claims one mail at a time so a slow server holds back only its own mail", async () => {
    for (let i = 0; i < 3; i++) await send(compose());
    await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second'");
    const seen: number[] = [];
    t.sendMail.mockClear();
    t.sendMail.mockImplementation(async () => {
      seen.push(await count("status='sending'"));
      return {};
    });
    await processDue(3);
    expect(seen).toEqual([1, 1, 1]);
    expect(await count("status='sent'")).toBe(3);
  });

  it("a mail marked failed/delivery_unknown becomes sent when SMTP finally accepts", async () => {
    const m = await send(compose());
    await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second' WHERE id=$1", [m.rowId]);
    t.sendMail.mockClear();
    t.sendMail.mockImplementation(async () => {
      await fx.pool.query("UPDATE mail_messages SET status='failed', last_error='delivery_unknown' WHERE id=$1", [m.rowId]);
      return {};
    });
    await processDue(1);
    const r = (await fx.pool.query("SELECT status, last_error FROM mail_messages WHERE id=$1", [m.rowId])).rows[0];
    expect(r).toMatchObject({ status: "sent", last_error: null });
  });

  it("a mail failed for another reason is never turned into sent", async () => {
    const m = await send(compose());
    await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second' WHERE id=$1", [m.rowId]);
    t.sendMail.mockClear();
    t.sendMail.mockImplementation(async () => {
      await fx.pool.query("UPDATE mail_messages SET status='failed', last_error='quota' WHERE id=$1", [m.rowId]);
      return {};
    });
    await processDue(1);
    expect((await fx.pool.query("SELECT status FROM mail_messages WHERE id=$1", [m.rowId])).rows[0].status).toBe("failed");
  });
});
