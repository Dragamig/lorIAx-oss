/**
 * Parcours de bout en bout du Mailing contre un VRAI serveur SMTP local (smtp-server, TLS implicite
 * et STARTTLS, certificat de test auto-signé) et la vraie base : configuration de la boîte, test de
 * connexion, programmation, annulation, renvoi, remise, trace CRM. Le transport est le vrai : IP figée
 * par pinHost (simulée vers 127.0.0.1, seul le DNS est remplacé) avec servername = hôte d'origine.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { setupMailingFixture, type CrmIds } from "./support/mailing-fixture";
import {
  startTestSmtpServer,
  trustTestCertificate,
  TEST_SMTP_HOSTNAME,
  TEST_SMTP_PASSWORD,
  TEST_SMTP_USER,
  type TestSmtpServer,
} from "./support/smtp-test-server";

const h = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  return { db: undefined as unknown, user: { id: "", globalRole: "editor" } };
});

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ ...h.user, name: "T", email: "t@x.fr" })),
}));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn(async () => "editor") }));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: vi.fn(async () => true) }));
vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Seul le DNS est remplacé : le nom de test résout vers la boucle locale, la logique de figeage reste réelle.
vi.mock("@/lib/security/url-validator-server", () => ({
  resolvePublicAddresses: async () => [{ address: "127.0.0.1", family: 4 }],
}));
vi.mock("../attachments", () => ({ resolveAttachments: async () => [], MAX_MAIL_ATTACHMENTS_BYTES: 1, uploadPrefix: () => "" }));

import { PUT as putAccount } from "@/app/api/mail/account/route";
import { POST as postTest } from "@/app/api/mail/account/test/route";
import { POST as postMessage } from "@/app/api/mail/messages/route";
import { POST as cancelMessage } from "@/app/api/mail/messages/[id]/cancel/route";
import { processDue } from "../outbox";
import { mailingTick } from "../tick";
import { invalidateTransport } from "../transport";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("parcours Mailing avec un vrai serveur SMTP (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupMailingFixture>>;
  let org: string, user: string, crm: CrmIds, claire: string;
  let restoreTrust: (() => void) | null = null;
  let smtp: TestSmtpServer | null = null;

  const req = (path: string, method = "GET", body?: unknown) =>
    new NextRequest(`http://x${path}`, {
      method,
      headers: { "x-org-slug": "org-flow" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const accountBody = (port: number, security: "ssl" | "starttls", over: Record<string, unknown> = {}) => ({
    address: TEST_SMTP_USER, displayName: "Moi", smtpHost: TEST_SMTP_HOSTNAME, smtpPort: port, smtpSecurity: security,
    imapHost: "imap.test.local", imapPort: 1, imapSecurity: "ssl", password: TEST_SMTP_PASSWORD, signature: "",
    cancelDelaySeconds: 30, pollIntervalMinutes: 0, ...over,
  });
  const connBody = (port: number, security: "ssl" | "starttls") => {
    const { displayName: _d, signature: _s, cancelDelaySeconds: _c, pollIntervalMinutes: _p, ...conn } = accountBody(port, security);
    void _d; void _s; void _c; void _p;
    return conn;
  };
  const compose = (over: Record<string, unknown> = {}) => ({
    clientKey: randomUUID(), databaseId: crm.contacts, rowId: claire, to: ["claire@ex.fr"], cc: [], bcc: [],
    subject: "Devis de mars", bodyHtml: "<p>Bonjour Claire, voici le devis.</p>", attachments: [], ...over,
  });
  async function start(security: "ssl" | "starttls") {
    smtp = await startTestSmtpServer({ secure: security === "ssl" });
    return smtp;
  }
  async function configure(security: "ssl" | "starttls") {
    const server = await start(security);
    const res = await putAccount(req("/api/mail/account", "PUT", accountBody(server.port, security)));
    expect(res.status).toBe(200);
    return server;
  }

  beforeAll(async () => {
    fx = await setupMailingFixture(URL!, "rh_mailing_flow");
    h.db = fx.db;
    await fx.newOrg("default", "1 day");
    org = await fx.newOrg("org-flow");
    user = await fx.newUser(org);
    h.user = { id: user, globalRole: "editor" };
    crm = await fx.newCrm(org, "F");
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    restoreTrust = trustTestCertificate();
    await fx.pool.query("DELETE FROM mail_messages");
    await fx.pool.query("DELETE FROM mail_accounts");
    await fx.pool.query("DELETE FROM user_database_rows WHERE database_id IN ($1,$2,$3)", [crm.contacts, crm.dossiers, crm.interactions]);
    claire = await fx.newRow(crm.contacts, { [crm.col.cNom]: "Claire Martin", [crm.col.cMail]: "claire@ex.fr" });
  });
  afterEach(async () => {
    restoreTrust?.();
    restoreTrust = null;
    await smtp?.close();
    smtp = null;
  });

  describe.each(["ssl", "starttls"] as const)("transport à IP figée en %s", (security) => {
    it("the connection test authenticates over TLS with the original hostname as servername", async () => {
      const server = await configure(security);
      const res = await postTest(req("/api/mail/account/test", "POST", connBody(server.port, security)));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.smtp).toEqual({ ok: true, message: "ok" });
      // La poignée de main TLS a bien annoncé le nom d'origine, pas l'IP figée.
      expect(server.sniNames).toContain(TEST_SMTP_HOSTNAME);
      expect(server.sniNames).not.toContain("127.0.0.1");
    });

    it("a real send negotiates TLS, authenticates and delivers the message", async () => {
      const server = await configure(security);
      const res = await postMessage(req("/api/mail/messages", "POST", compose()));
      expect(res.status).toBe(201);
      const { id } = await res.json();
      await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second' WHERE id = $1", [id]);
      await processDue();

      expect(server.received).toHaveLength(1);
      const mail = server.received[0];
      expect(mail.secure).toBe(true);
      expect(mail.authUser).toBe(TEST_SMTP_USER);
      expect(mail.to).toEqual(["claire@ex.fr"]);
      expect(server.sniNames).toContain(TEST_SMTP_HOSTNAME);
      const row = (await fx.pool.query("SELECT status, message_id FROM mail_messages WHERE id = $1", [id])).rows[0];
      expect(row.status).toBe("sent");
      expect(mail.raw).toContain(`Message-ID: ${row.message_id}`);
    });
  });

  it("the test certificate is NOT accepted outside the test trust (tls_error)", async () => {
    const server = await configure("ssl");
    restoreTrust?.();
    restoreTrust = null;
    const res = await postTest(req("/api/mail/account/test", "POST", connBody(server.port, "ssl")));
    const body = await res.json();
    expect(body.smtp.ok).toBe(false);
    expect(body.smtp.message).toMatch(/^tls_error/);
    expect(server.received).toHaveLength(0);
  });

  it("a wrong password is reported as auth_failed without leaking it", async () => {
    const server = await start("ssl");
    const res = await postTest(
      req("/api/mail/account/test", "POST", { ...connBody(server.port, "ssl"), password: "pas-le-bon" }),
    );
    const body = await res.json();
    expect(body.smtp.ok).toBe(false);
    expect(body.smtp.message).toMatch(/^auth_failed/);
    expect(JSON.stringify(body)).not.toContain("pas-le-bon");
  });

  it("walks the whole journey: configure, test, write, cancel, rewrite, deliver, trace", async () => {
    const server = await configure("starttls");
    const test = await (await postTest(req("/api/mail/account/test", "POST", connBody(server.port, "starttls")))).json();
    expect(test.smtp.ok).toBe(true);

    // Écrire puis annuler dans le délai : rien ne part, même échéance dépassée.
    const first = await postMessage(req("/api/mail/messages", "POST", compose()));
    expect(first.status).toBe(201);
    const { id: cancelledId } = await first.json();
    expect((await cancelMessage(req(`/api/mail/messages/${cancelledId}/cancel`, "POST"), params(cancelledId))).status).toBe(200);
    await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 minute' WHERE id = $1", [cancelledId]);
    await processDue();
    expect(server.received).toHaveLength(0);

    // Réécrire (nouvelle clé de brouillon) et laisser partir.
    const second = await postMessage(req("/api/mail/messages", "POST", compose({ subject: "Devis de mars, version 2" })));
    expect(second.status).toBe(201);
    const { id } = await second.json();
    await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second' WHERE id = $1", [id]);
    await processDue();

    // Côté serveur de test : un seul mail, le bon.
    expect(server.received).toHaveLength(1);
    expect(server.received[0].raw).toContain("Subject: Devis de mars, version 2");
    expect(server.received[0].raw).toContain("voici le devis");

    // Au plus une fois : un tick de rattrapage ne le renvoie pas.
    await mailingTick(new Date(Date.now() + 10 * 60_000));
    expect(server.received).toHaveLength(1);

    // Trace CRM : dossier automatique pour un contact sans dossier, Interaction rattachée.
    const msg = (await fx.pool.query("SELECT * FROM mail_messages WHERE id = $1", [id])).rows[0];
    expect(msg.status).toBe("sent");
    expect(msg.dossier_row_id).toBeTruthy();
    expect(msg.interaction_row_id).toBeTruthy();
    const dossier = (await fx.pool.query("SELECT cells FROM user_database_rows WHERE id = $1 AND database_id = $2", [msg.dossier_row_id, crm.dossiers])).rows[0];
    expect(dossier.cells[crm.col.dTitre]).toBe("Contact entrant : Claire Martin");
    expect(dossier.cells[crm.col.dContact]).toEqual([claire]);
    const ix = (await fx.pool.query("SELECT cells FROM user_database_rows WHERE id = $1 AND database_id = $2", [msg.interaction_row_id, crm.interactions])).rows[0];
    expect(ix.cells[crm.col.iTitre]).toBe("Devis de mars, version 2");
    expect(ix.cells[crm.col.iDossier]).toEqual([msg.dossier_row_id]);
    expect(ix.cells[crm.col.iContact]).toEqual([claire]);
    expect(String(ix.cells[crm.col.iType]).length).toBeGreaterThan(0);
    expect(
      Number((await fx.pool.query("SELECT count(*)::int AS n FROM user_database_rows WHERE database_id = $1", [crm.interactions])).rows[0].n),
    ).toBe(1);
    invalidateTransport(msg.account_id);
  });
});
