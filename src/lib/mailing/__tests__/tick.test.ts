import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupCrmFixture } from "@/lib/crm/__tests__/crm-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  pool: undefined as unknown as { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  failTrace: false,
  throwOn: null as string | null,
  failBeforeTouch: null as string | null,
  disconnected: false,
  forbidden: false,
  alerts: [] as unknown[],
}));
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
vi.mock("../transport", () => ({
  getTransport: () => ({ sendMail: t.sendMail }),
  appendToSent: async () => true,
  invalidateTransport: () => {},
}));
vi.mock("../crm-trace", async (orig) => ({
  ...(await orig<typeof import("../crm-trace")>()),
  ensureDossierForMail: vi.fn(async (_c: unknown, i: { dossierRowId?: string | null }) => ({
    dossierRowId: i.dossierRowId ?? "00000000-0000-0000-0000-0000000000d1",
    created: false,
  })),
  writeMailInteraction: vi.fn(async (m: { id: string }) => {
    if (h.disconnected) throw new CrmDisconnectedError();
    if (h.forbidden) throw new CrmTraceForbiddenError();
    if (h.failTrace) throw new Error("crm down");
    const id = "00000000-0000-0000-0000-0000000000a1";
    await h.pool.query("UPDATE mail_messages SET interaction_row_id=$1 WHERE id=$2", [id, m.id]);
    return { interactionRowId: id };
  }),
}));
vi.mock("../outbox", async (orig) => {
  const actual = await orig<typeof import("../outbox")>();
  return {
    ...actual,
    touchSending: vi.fn(async (m: { id: string }) => {
      if (h.failBeforeTouch === m.id) {
        await h.pool.query("UPDATE mail_messages SET status='failed', last_error='delivery_unknown' WHERE id=$1", [m.id]);
      }
      return actual.touchSending(m as never);
    }),
    deliver: vi.fn(async (m: { id: string }) => {
      if (h.throwOn === m.id) throw new Error("boom");
      return actual.deliver(m as never);
    }),
  };
});

import { mailingTick, getTraceAlert } from "../tick";
import { CrmDisconnectedError, CrmTraceForbiddenError, writeMailInteraction } from "../crm-trace";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("mailing tick (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupCrmFixture>>;
  const ORG = randomUUID();
  const USER = randomUUID();
  const ACC = randomUUID();

  async function insert(over: { status: string; scheduled?: string; updated?: string; sentAt?: boolean; lastError?: string | null; contact?: boolean; interaction?: boolean }) {
    const id = randomUUID();
    await fx.pool.query(
      `INSERT INTO mail_messages (id, organization_id, account_id, user_id, direction, status, message_id, from_address,
         to_addresses, subject, scheduled_at, sent_at, last_error, client_key, contact_row_id, interaction_row_id, updated_at)
       VALUES ($1,$2,$3,$4,'out',$5,$6,'me@example.fr','{c@x.fr}','S', ${over.scheduled ?? "NULL"}, ${over.sentAt ? "now()" : "NULL"},
         $7,$8,${over.contact === false ? "NULL" : "gen_random_uuid()"}, ${over.interaction ? "gen_random_uuid()" : "NULL"}, ${over.updated ?? "now()"})`,
      [id, ORG, ACC, USER, over.status, `<${id}@example.fr>`, over.lastError ?? null, id.slice(0, 20)],
    );
    return id;
  }
  const row = async (id: string) =>
    (await fx.pool.query("SELECT status, last_error, interaction_row_id, attempts, scheduled_at, trace_attempts FROM mail_messages WHERE id=$1", [id])).rows[0];

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_mailing_tick");
    h.db = fx.db;
    h.pool = fx.pool as never;
    for (const f of ["0061_mail_accounts.sql", "0062_mail_messages.sql", "0063_mail_trace_attempts.sql", "0064_mail_messages_account_set_null.sql"]) {
      await fx.pool.query(readFileSync(join(process.cwd(), "src/lib/db/migrations", f), "utf8"));
    }
    await fx.pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1,'o','O')", [ORG]);
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
    await fx.pool.query(
      `INSERT INTO mail_accounts (id, organization_id, user_id, address, smtp_host, smtp_port, smtp_security,
        imap_host, imap_port, imap_security, cancel_delay_seconds) VALUES ($1,$2,$3,'me@example.fr','smtp.example.fr',465,'ssl','imap.example.fr',993,'ssl',10)`,
      [ACC, ORG, USER],
    );
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    await fx.pool.query("DELETE FROM mail_messages");
    h.failTrace = false;
    h.throwOn = null;
    h.failBeforeTouch = null;
    h.disconnected = false;
    h.forbidden = false;
    t.sendMail.mockReset();
    t.sendMail.mockImplementation(async () => ({}));
    vi.mocked(writeMailInteraction).mockClear();
  });

  it("tick delivers a due mail missed by the timer (server restarted)", async () => {
    const id = await insert({ status: "scheduled", scheduled: "now() - interval '1 minute'" });
    const r = await mailingTick();
    expect(r.delivered).toBe(1);
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    expect((await row(id)).status).toBe("sent");
  });

  it("tick ignores mails scheduled in the future", async () => {
    const id = await insert({ status: "scheduled", scheduled: "now() + interval '1 hour'" });
    const r = await mailingTick();
    expect(r.delivered).toBe(0);
    expect(t.sendMail).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe("scheduled");
  });

  it("tick reconciles a sent mail without interaction and sets interaction_row_id", async () => {
    const id = await insert({ status: "sent", sentAt: true, updated: "now() - interval '5 minutes'" });
    const r = await mailingTick();
    expect(r.reconciled).toBe(1);
    const m = await row(id);
    expect(m.interaction_row_id).toBeTruthy();
    expect(m.last_error).toBeNull();
  });

  it("tick leaves a freshly sent mail alone (under one minute)", async () => {
    const id = await insert({ status: "sent", sentAt: true });
    expect((await mailingTick()).reconciled).toBe(0);
    expect((await row(id)).interaction_row_id).toBeNull();
  });

  it("tick stops reconciling after 10 attempts", async () => {
    h.failTrace = true;
    const id = await insert({ status: "sent", sentAt: true, updated: "now() - interval '5 minutes'" });
    for (let i = 0; i < 12; i++) {
      await mailingTick();
      await fx.pool.query("UPDATE mail_messages SET updated_at = now() - interval '5 minutes' WHERE id=$1", [id]);
    }
    const calls = vi.mocked(writeMailInteraction).mock.calls.length;
    expect(calls).toBe(10);
    expect((await row(id)).trace_attempts).toBe(10);
    const m = await row(id);
    expect(m.last_error).toBe("trace");
    expect(m.status).toBe("sent");
    expect(await getTraceAlert(ORG, USER)).toMatchObject({ pending: 1 });
  });

  it("tick fails a sending mail stuck over 5 min as delivery_unknown, never resending", async () => {
    const id = await insert({ status: "sending", updated: "now() - interval '6 minutes'" });
    await mailingTick();
    const m = await row(id);
    expect(m.status).toBe("failed");
    expect(m.last_error).toBe("delivery_unknown");
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it("tick never requeues or resends a sending mail, even one that has sentAt", async () => {
    const id = await insert({ status: "sending", sentAt: true, updated: "now() - interval '10 minutes'" });
    await mailingTick();
    const m = await row(id);
    expect(m.status).not.toBe("scheduled");
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it("tick leaves a recent sending mail untouched", async () => {
    const id = await insert({ status: "sending", updated: "now() - interval '1 minute'" });
    await mailingTick();
    expect((await row(id)).status).toBe("sending");
  });

  it("a throwing deliver does not stop the rest of the batch", async () => {
    const a = await insert({ status: "scheduled", scheduled: "now() - interval '2 minutes'" });
    const b = await insert({ status: "scheduled", scheduled: "now() - interval '1 minute'" });
    h.throwOn = a;
    await mailingTick();
    expect((await row(a)).status).toBe("failed");
    expect((await row(b)).status).toBe("sent");
  });

  it("a mail flipped to failed before its turn is never sent", async () => {
    const id = await insert({ status: "scheduled", scheduled: "now() - interval '1 minute'" });
    h.failBeforeTouch = id;
    const r = await mailingTick();
    expect(t.sendMail).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe("failed");
    expect(r.delivered).toBe(0);
  });

  it("two concurrent ticks send each mail once", async () => {
    for (let i = 0; i < 4; i++) await insert({ status: "scheduled", scheduled: "now() - interval '1 minute'" });
    await Promise.all([mailingTick(), mailingTick()]);
    expect(t.sendMail).toHaveBeenCalledTimes(4);
  });

  it("delivered counts only mails that reached sent", async () => {
    await insert({ status: "scheduled", scheduled: "now() - interval '1 minute'" });
    t.sendMail.mockRejectedValueOnce(Object.assign(new Error("550 no"), { responseCode: 550 }));
    expect((await mailingTick()).delivered).toBe(0);
  });

  it("a disconnected CRM does not consume trace attempts", async () => {
    h.disconnected = true;
    const id = await insert({ status: "sent", sentAt: true, updated: "now() - interval '5 minutes'" });
    for (let i = 0; i < 12; i++) {
      await mailingTick();
      await fx.pool.query("UPDATE mail_messages SET updated_at = now() - interval '5 minutes' WHERE id=$1", [id]);
    }
    const m = await row(id);
    expect(m.trace_attempts).toBe(0);
    expect(m.last_error).toBeNull();
  });

  it("a sender without edit right abandons the trace once and never replays it", async () => {
    h.forbidden = true;
    const id = await insert({ status: "sent", sentAt: true, updated: "now() - interval '5 minutes'" });
    for (let i = 0; i < 4; i++) {
      await mailingTick();
      await fx.pool.query("UPDATE mail_messages SET updated_at = now() - interval '5 minutes' WHERE id=$1", [id]);
    }
    expect(vi.mocked(writeMailInteraction).mock.calls.length).toBe(1);
    expect((await row(id)).last_error).toBe("trace");
  });

  it("getTraceAlert reports crmDisconnected when the interactions database is unset", async () => {
    const r = await getTraceAlert(ORG, USER);
    expect(r.crmDisconnected).toBe(true);
    expect(r.pending).toBe(0);
  });

  it("getTraceAlert is scoped to the organization", async () => {
    await insert({ status: "sent", sentAt: true });
    expect((await getTraceAlert(randomUUID(), USER)).pending).toBe(0);
    expect((await getTraceAlert(ORG, USER)).pending).toBe(1);
  });

  it("getTraceAlert counts only the mails of the given user", async () => {
    await insert({ status: "sent", sentAt: true });
    expect((await getTraceAlert(ORG, randomUUID())).pending).toBe(0);
  });

  it("tick claims one mail at a time so a slow server does not hold the whole batch", async () => {
    for (let i = 0; i < 3; i++) await insert({ status: "scheduled", scheduled: "now() - interval '1 minute'" });
    const seen: number[] = [];
    t.sendMail.mockImplementation(async () => {
      seen.push(Number((await fx.pool.query("SELECT count(*)::int AS n FROM mail_messages WHERE status='sending'")).rows[0].n));
      return {};
    });
    await mailingTick();
    expect(seen).toEqual([1, 1, 1]);
  });

  it("a scheduled mail whose account was deleted fails as account_missing", async () => {
    const id = await insert({ status: "scheduled", scheduled: "now() - interval '1 minute'" });
    await fx.pool.query("UPDATE mail_messages SET account_id = NULL WHERE id=$1", [id]);
    await mailingTick();
    expect(await row(id)).toMatchObject({ status: "failed", last_error: "account_missing" });
    expect(t.sendMail).not.toHaveBeenCalled();
  });
});
