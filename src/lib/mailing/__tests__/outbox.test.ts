import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface Call { op: string; set?: Record<string, unknown>; values?: Record<string, unknown> }
const h = vi.hoisted(() => ({
  calls: [] as { op: string; set?: Record<string, unknown>; values?: Record<string, unknown> }[],
  results: { select: [] as unknown[][], insert: [] as unknown[][], update: [] as unknown[][] },
  getAccount: vi.fn(),
  resolveFiche: vi.fn(),
  resolveAttachments: vi.fn(),
  checkQuota: vi.fn(),
  peekQuota: vi.fn(),
  sendMail: vi.fn(),
  append: vi.fn(),
  ensureDossier: vi.fn(),
  writeInteraction: vi.fn(),
  audit: vi.fn(),
  failUpdates: false,
}));

function chain(op: string, result: unknown[]) {
  const call: Call = { op };
  h.calls.push(call);
  const fail = op === "update" && h.failUpdates;
  const p: unknown = new Proxy(function () {}, {
    get(_t, k) {
      if (k === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => (fail ? Promise.reject(new Error("db down")) : Promise.resolve(result)).then(res, rej);
      return (...a: unknown[]) => {
        if (k === "set") call.set = a[0] as Record<string, unknown>;
        if (k === "values") call.values = a[0] as Record<string, unknown>;
        return p;
      };
    },
  });
  return p;
}
vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain("select", h.results.select.shift() ?? []),
    insert: () => chain("insert", h.results.insert.shift() ?? []),
    update: () => chain("update", h.results.update.shift() ?? []),
  },
}));
vi.mock("@/lib/audit/log", () => ({ auditLog: (...a: unknown[]) => h.audit(...a) }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../accounts", () => ({ getAccountFor: (...a: unknown[]) => h.getAccount(...a) }));
vi.mock("../attachments", () => ({ resolveAttachments: (...a: unknown[]) => h.resolveAttachments(...a) }));
vi.mock("../quota", () => ({
  checkMailQuota: (...a: unknown[]) => h.checkQuota(...a),
  peekMailQuota: (...a: unknown[]) => h.peekQuota(...a),
}));
vi.mock("../crm-trace", () => ({
  resolveFicheContext: (...a: unknown[]) => h.resolveFiche(...a),
  ensureDossierForMail: (...a: unknown[]) => h.ensureDossier(...a),
  writeMailInteraction: (...a: unknown[]) => h.writeInteraction(...a),
}));
vi.mock("nodemailer/lib/mail-composer", () => ({
  default: class {
    compile() {
      return { keepBcc: false, build: async () => Buffer.from("raw") };
    }
  },
}));
vi.mock("../transport", () => ({
  getTransport: () => ({ sendMail: (...a: unknown[]) => h.sendMail(...a) }),
  appendToSent: (...a: unknown[]) => h.append(...a),
}));

import { scheduleMail, cancelScheduled, deliver, MailError, SEND_TIMEOUT_MS } from "../outbox";
import type { MailMessageRow } from "@/lib/db/schema-mailing";
import type { ComposeInput } from "../compose";
import type { FicheContext } from "../crm-trace";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const account = (over: Record<string, unknown> = {}) => ({
  id: "acc", organizationId: ORG, userId: USER, address: "Moi@Example.fr", displayName: "Moi",
  signature: "", cancelDelaySeconds: 10, status: "ok", ...over,
});
const fiche: FicheContext = {
  role: "contacts", contactRowId: "contact1", contactDatabaseId: "cdb", contactEmail: "c@x.fr", contactName: "C",
  dossiers: [{ rowId: "dos1", title: "D", updatedAt: new Date() }], defaultDossierRowId: "dos1", fixedDossierRowId: null,
};
const compose = (over: Partial<ComposeInput> = {}) =>
  ({
    clientKey: "33333333-3333-4333-8333-333333333333", databaseId: "cdb", rowId: "contact1",
    to: ["c@x.fr"], cc: [], bcc: [], subject: "Bonjour", bodyHtml: "<p>Salut</p>", attachments: [], ...over,
  }) as ComposeInput;
const inserted = () => h.calls.find((c) => c.op === "insert");

beforeEach(() => {
  h.failUpdates = false;
  vi.useFakeTimers();
  h.calls.length = 0;
  h.results.select = []; h.results.insert = []; h.results.update = [];
  for (const f of [h.getAccount, h.resolveFiche, h.resolveAttachments, h.checkQuota, h.peekQuota, h.sendMail, h.append, h.ensureDossier, h.writeInteraction, h.audit]) f.mockReset();
  h.getAccount.mockResolvedValue(account());
  h.resolveFiche.mockResolvedValue(fiche);
  h.resolveAttachments.mockResolvedValue([]);
  h.checkQuota.mockResolvedValue({ ok: true });
  h.peekQuota.mockResolvedValue({ exceeded: false, limit: 50 });
  h.sendMail.mockResolvedValue({});
  h.append.mockResolvedValue(true);
  h.ensureDossier.mockResolvedValue({ dossierRowId: "dos1", created: false });
  h.writeInteraction.mockResolvedValue({ interactionRowId: "ix1" });
});
afterEach(() => vi.useRealTimers());

describe("scheduleMail", () => {
  const rowBack = (over: Record<string, unknown> = {}) => [{ id: "row1", messageId: "<m@example.fr>", scheduledAt: new Date(), ...over }];

  it("scheduleMail with delay 0 schedules for now", async () => {
    h.getAccount.mockResolvedValue(account({ cancelDelaySeconds: 0 }));
    h.results.select = [[]];
    h.results.insert = [rowBack()];
    await scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche });
    const at = inserted()!.values!.scheduledAt as Date;
    expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(50);
  });

  it("scheduleMail uses the account cancel delay", async () => {
    h.getAccount.mockResolvedValue(account({ cancelDelaySeconds: 20 }));
    h.results.select = [[]];
    h.results.insert = [rowBack()];
    const out = await scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche });
    expect((inserted()!.values!.scheduledAt as Date).getTime() - Date.now()).toBe(20_000);
    expect(out.cancelDelaySeconds).toBe(20);
    expect(h.audit).toHaveBeenCalledWith("mail.send.scheduled", USER, expect.anything());
  });

  it("scheduleMail without account throws no_account", async () => {
    h.getAccount.mockResolvedValue(null);
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche })).rejects.toMatchObject({ code: "no_account" });
  });

  it("scheduleMail refuses an unverified mailbox and inserts nothing", async () => {
    h.getAccount.mockResolvedValue(account({ status: "unverified" } as never));
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche })).rejects.toMatchObject({ code: "account_unverified" });
    expect(inserted()).toBeUndefined();
  });

  it("scheduleMail refuses a mailbox whose last test failed, with the reason", async () => {
    h.getAccount.mockResolvedValue(account({ status: "error", statusMessage: "smtp: 535 refusé" } as never));
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche })).rejects.toMatchObject({
      code: "account_error",
      detail: { statusMessage: "smtp: 535 refusé" },
    });
    expect(inserted()).toBeUndefined();
  });

  it("scheduleMail refuses when the quota is exceeded and inserts nothing", async () => {
    h.results.select = [[]];
    h.checkQuota.mockResolvedValue({ ok: false, reason: "plan", limit: 50 });
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose({ cc: ["d@x.fr"] }), ctx: fiche })).rejects.toMatchObject({ code: "quota" });
    expect(h.checkQuota).toHaveBeenCalledWith(ORG, USER, 2);
    expect(inserted()).toBeUndefined();
  });

  it("scheduleMail refuses a fiche the user cannot read", async () => {
    h.resolveFiche.mockResolvedValue(null);
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche })).rejects.toMatchObject({ code: "fiche_forbidden" });
    expect(inserted()).toBeUndefined();
  });

  it("scheduleMail refuses CR/LF in the subject and in inReplyToMessageId", async () => {
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose({ subject: "a\r\nBcc: x@y.z" }), ctx: fiche })).rejects.toMatchObject({ code: "invalid_header" });
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose({ inReplyToMessageId: "<a>\nX: 1" }), ctx: fiche })).rejects.toMatchObject({ code: "invalid_header" });
    expect(inserted()).toBeUndefined();
  });

  it("scheduleMail refuses a dossier that does not belong to the contact", async () => {
    await expect(scheduleMail({ orgId: ORG, userId: USER, compose: compose({ dossierRowId: "00000000-0000-4000-8000-000000000000" }), ctx: fiche })).rejects.toMatchObject({ code: "dossier_mismatch" });
  });

  it("scheduleMail takes organization and owner from the account, not from the caller", async () => {
    h.getAccount.mockResolvedValue(account({ organizationId: "acct-org", userId: "acct-user" }));
    h.results.select = [[]];
    h.results.insert = [rowBack()];
    await scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche });
    expect(inserted()!.values).toMatchObject({ organizationId: "acct-org", userId: "acct-user", accountId: "acc", status: "scheduled", contactRowId: "contact1" });
  });

  it("scheduleMail returns the existing row for a repeated client key without consuming quota", async () => {
    h.results.select = [rowBack({ id: "old" })];
    const out = await scheduleMail({ orgId: ORG, userId: USER, compose: compose(), ctx: fiche });
    expect(out.rowId).toBe("old");
    expect(h.checkQuota).not.toHaveBeenCalled();
    expect(inserted()).toBeUndefined();
  });
});

describe("cancelScheduled", () => {
  it("cancelScheduled succeeds before the delay", async () => {
    h.results.update = [[{ id: "m1" }]];
    expect(await cancelScheduled(ORG, USER, "m1")).toBe(true);
    expect(h.calls[0].set).toMatchObject({ status: "cancelled" });
  });
  it("cancelScheduled returns false once status is sending", async () => {
    h.results.update = [[]];
    expect(await cancelScheduled(ORG, USER, "m1")).toBe(false);
  });
});

describe("deliver", () => {
  const message = (over: Partial<MailMessageRow> = {}) =>
    ({
      id: "m1", organizationId: ORG, accountId: "acc", userId: USER, direction: "out", status: "sending",
      messageId: "<m1@example.fr>", inReplyTo: null, references: [], threadKey: "m1@example.fr",
      fromAddress: "moi@example.fr", toAddresses: ["c@x.fr"], ccAddresses: [], bccAddresses: ["hidden@x.fr"],
      subject: "Bonjour", bodyHtml: "<p>Salut</p>", bodyText: "Salut", attachments: [], attempts: 1,
      contactRowId: "contact1", contactDatabaseId: "cdb", dossierRowId: null, dossierDatabaseId: null,
      interactionRowId: null, sentAt: null, createdAt: new Date(), ...over,
    }) as MailMessageRow;
  const sets = () => h.calls.filter((c) => c.op === "update").map((c) => c.set!);
  const withAccount = (over: Record<string, unknown> = {}) => { h.results.select = [[account(over)]]; };

  it("deliver re-checks the quota and marks failed with last_error \"quota\"", async () => {
    withAccount();
    h.peekQuota.mockResolvedValue({ exceeded: true, limit: 50 });
    await deliver(message());
    expect(sets()[0]).toMatchObject({ status: "failed", lastError: "quota" });
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("deliver sends with the stored Message-ID, then marks sent", async () => {
    withAccount();
    h.results.update = [[message({ status: "sent", sentAt: new Date() })]];
    await deliver(message());
    expect(h.sendMail.mock.calls[0][0]).toMatchObject({ messageId: "<m1@example.fr>", envelope: { to: ["c@x.fr", "hidden@x.fr"] } });
    expect(sets()[0]).toMatchObject({ status: "sent" });
    expect(h.audit).toHaveBeenCalledWith("mail.send", USER, expect.anything());
    expect(h.writeInteraction).toHaveBeenCalled();
  });

  it("deliver keeps status sent when IMAP APPEND fails", async () => {
    withAccount();
    h.results.update = [[message({ status: "sent" })]];
    h.append.mockRejectedValue(new Error("imap down"));
    await deliver(message());
    expect(sets().some((s) => s.status === "failed")).toBe(false);
    expect(sets()[0]).toMatchObject({ status: "sent" });
    expect(h.writeInteraction).toHaveBeenCalled();
  });

  it("deliver keeps status sent and interaction_row_id null when the trace fails", async () => {
    withAccount();
    h.results.update = [[message({ status: "sent" })]];
    h.writeInteraction.mockRejectedValue(new Error("crm down"));
    await expect(deliver(message())).resolves.toBeUndefined();
    expect(sets().some((s) => s.status === "failed")).toBe(false);
    expect(sets().some((s) => "interactionRowId" in s)).toBe(false);
  });

  it("deliver creates the automatic dossier for a contact without dossier", async () => {
    withAccount();
    h.results.update = [[message({ status: "sent" })], []];
    h.ensureDossier.mockResolvedValue({ dossierRowId: "auto1", created: true });
    await deliver(message());
    expect(h.ensureDossier).toHaveBeenCalledWith({ orgId: ORG, userId: USER }, { contactRowId: "contact1", dossierRowId: null });
    expect(sets().some((s) => s.dossierRowId === "auto1")).toBe(true);
    expect(h.writeInteraction.mock.calls[0][0]).toMatchObject({ dossierRowId: "auto1" });
  });

  it("deliver retries once on a 4xx and fails on a 5xx", async () => {
    withAccount();
    h.sendMail.mockRejectedValue(Object.assign(new Error("try later"), { responseCode: 451 }));
    await deliver(message({ attempts: 1 }));
    expect(sets()[0]).toMatchObject({ status: "scheduled" });
    expect((sets()[0].scheduledAt as Date).getTime() - Date.now()).toBe(60_000);

    h.calls.length = 0;
    withAccount();
    await deliver(message({ attempts: 2 }));
    expect(sets()[0]).toMatchObject({ status: "failed" });

    h.calls.length = 0;
    withAccount();
    h.sendMail.mockRejectedValue(Object.assign(new Error("mailbox unavailable"), { responseCode: 550 }));
    await deliver(message({ attempts: 1 }));
    expect(sets()[0]).toMatchObject({ status: "failed", lastError: "mailbox unavailable" });
  });

  it("deliver never writes failed nor requeues when the sent update keeps rejecting", async () => {
    vi.useRealTimers();
    withAccount();
    h.failUpdates = true;
    await expect(deliver(message())).resolves.toBeUndefined();
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    const writes = sets();
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every((s) => s.status === "sent")).toBe(true);
    expect(h.writeInteraction).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("deliver skips audit and trace when the sent update touches no row", async () => {
    withAccount();
    h.results.update = [[]];
    await deliver(message());
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.writeInteraction).not.toHaveBeenCalled();
  });

  it("deliver fails with delivery_unknown when sendMail exceeds the total timeout, without resending", async () => {
    withAccount();
    h.sendMail.mockReturnValue(new Promise(() => {}));
    const p = deliver(message());
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1);
    await p;
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    expect(sets()[0]).toMatchObject({ status: "failed", lastError: "delivery_unknown" });
    expect(sets().some((s) => s.status === "scheduled")).toBe(false);
  });

  it("deliver records sent when SMTP finally accepts after the timeout", async () => {
    withAccount();
    let accept!: (v: unknown) => void;
    h.sendMail.mockReturnValue(new Promise((r) => { accept = r; }));
    h.results.update = [[], [message({ status: "sent", sentAt: new Date() })]];
    const p = deliver(message());
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1);
    await p;
    accept({});
    await vi.advanceTimersByTimeAsync(10);
    expect(sets().map((s) => s.status).slice(0, 2)).toEqual(["failed", "sent"]);
    expect(h.audit).toHaveBeenCalledWith("mail.send", USER, expect.anything());
  });

  it("deliver refuses CR/LF in the subject before building headers", async () => {
    withAccount();
    await deliver(message({ subject: "a\nBcc: x@y.z" }));
    expect(h.sendMail).not.toHaveBeenCalled();
    expect(sets()[0]).toMatchObject({ status: "failed" });
  });
});

describe("MailError", () => {
  it("carries a code", () => expect(new MailError("quota").code).toBe("quota"));
});
