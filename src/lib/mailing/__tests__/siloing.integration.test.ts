/**
 * Cloisonnement du Mailing contre la vraie base (schéma rh_mailing_siloing). Les gardes de route
 * (requireCrm, requireOrgScoped, resolveRequestOrg) lisent la base ; seuls la session, le juge de
 * permission d'espace, la disponibilité du module, l'offre, le transport SMTP et l'audit sont simulés.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { setupMailingFixture, type CrmIds } from "./support/mailing-fixture";

const h = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  return {
    db: undefined as unknown,
    user: { id: "", globalRole: "editor" } as { id: string; globalRole: string },
    sendMail: vi.fn(async () => ({})),
    audit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ ...h.user, name: "T", email: "t@x.fr" })),
}));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn(async () => "editor") }));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: vi.fn(async () => true) }));
vi.mock("@/lib/audit/log", () => ({ auditLog: (...a: unknown[]) => h.audit(...a) }));
vi.mock("@/lib/logger", () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/security/url-validator-server", () => ({
  resolvePublicAddresses: async () => {
    throw new Error("hôte privé");
  },
}));
vi.mock("../attachments", () => ({ resolveAttachments: async () => [], MAX_MAIL_ATTACHMENTS_BYTES: 1, uploadPrefix: () => "" }));
vi.mock("../transport", () => ({
  getTransport: () => ({ sendMail: h.sendMail }),
  appendToSent: async () => true,
  invalidateTransport: () => {},
}));

import { GET as getAccount, PUT as putAccount, DELETE as deleteAccount } from "@/app/api/mail/account/route";
import { POST as postTest } from "@/app/api/mail/account/test/route";
import { GET as listMessages, POST as postMessage } from "@/app/api/mail/messages/route";
import { GET as getMessage } from "@/app/api/mail/messages/[id]/route";
import { POST as cancelMessage } from "@/app/api/mail/messages/[id]/cancel/route";
import { GET as getContext } from "@/app/api/mail/context/route";
import { processDue } from "../outbox";
import { mailingTick } from "../tick";
import { listFicheMails } from "../threads";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const PASSWORD = "Sup3r-Secret-Mailbox-Pass";

describe.skipIf(!URL)("cloisonnement du Mailing (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupMailingFixture>>;
  let orgA: string, orgB: string;
  let ua: string, ub: string, uc: string; // ua et ub : organisation A ; uc : organisation B
  let crmA: CrmIds, crmB: CrmIds;
  let claire: string; // contact de l'organisation A
  let bob: string; // contact de l'organisation B
  const seen: unknown[] = []; // toutes les réponses JSON des routes

  const as = (id: string) => {
    h.user = { id, globalRole: "editor" };
  };
  const req = (slug: string, path: string, method = "GET", body?: unknown) =>
    new NextRequest(`http://x${path}`, {
      method,
      headers: { "x-org-slug": slug },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  async function json(res: Response) {
    const body = await res.json().catch(() => null);
    seen.push(body);
    return body as Record<string, unknown> | null;
  }
  const accountBody = (over: Record<string, unknown> = {}) => ({
    address: "me@example.fr", displayName: "Moi", smtpHost: "smtp.example.fr", smtpPort: 465, smtpSecurity: "ssl",
    imapHost: "imap.example.fr", imapPort: 993, imapSecurity: "ssl", password: PASSWORD, signature: "",
    cancelDelaySeconds: 30, pollIntervalMinutes: 5, ...over,
  });
  /** Corps du test de connexion : seulement les champs de connexion (schéma strict). */
  const testBody = (over: Record<string, unknown> = {}) => {
    const { displayName: _d, signature: _s, cancelDelaySeconds: _c, pollIntervalMinutes: _p, ...conn } = accountBody();
    void _d; void _s; void _c; void _p;
    return { ...conn, ...over };
  };
  const composeBody = (databaseId: string, rowId: string, over: Record<string, unknown> = {}) => ({
    clientKey: randomUUID(), databaseId, rowId, to: ["claire@ex.fr"], cc: [], bcc: [],
    subject: "Bonjour", bodyHtml: "<p>Salut</p>", attachments: [], ...over,
  });
  async function setAccount(slug: string, user: string, over: Record<string, unknown> = {}) {
    as(user);
    const res = await putAccount(req(slug, "/api/mail/account", "PUT", accountBody(over)));
    expect(res.status).toBe(200);
    await json(res);
  }
  const count = async (where = "true") =>
    Number((await fx.pool.query(`SELECT count(*)::int AS n FROM mail_messages WHERE ${where}`)).rows[0].n);

  beforeAll(async () => {
    fx = await setupMailingFixture(URL!, "rh_mailing_siloing");
    h.db = fx.db;
    await fx.newOrg("default", "1 day");
    orgA = await fx.newOrg("org-a");
    orgB = await fx.newOrg("org-b");
    ua = await fx.newUser(orgA);
    ub = await fx.newUser(orgA);
    uc = await fx.newUser(orgB);
    crmA = await fx.newCrm(orgA, "A");
    crmB = await fx.newCrm(orgB, "B");
    claire = await fx.newRow(crmA.contacts, { [crmA.col.cNom]: "Claire Martin", [crmA.col.cMail]: "claire@ex.fr" });
    bob = await fx.newRow(crmB.contacts, { [crmB.col.cNom]: "Bob", [crmB.col.cMail]: "bob@ex.fr" });
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    h.sendMail.mockClear();
    h.audit.mockClear();
    await fx.pool.query("DELETE FROM mail_messages");
    await fx.pool.query("DELETE FROM mail_accounts");
  });

  describe("comptes mail", () => {
    it("user B of org A cannot read, update, test or delete user A's account (404)", async () => {
      await setAccount("org-a", ua);
      const before = (await fx.pool.query("SELECT * FROM mail_accounts WHERE user_id = $1", [ua])).rows[0];

      as(ub);
      // Lecture : aucune boîte pour B, jamais celle de A.
      const read = await json(await getAccount(req("org-a", "/api/mail/account")));
      expect(read).toEqual({ account: null });
      // Suppression : rien à supprimer pour B (404 muet), la boîte de A reste.
      const del = await deleteAccount(req("org-a", "/api/mail/account", "DELETE"));
      expect(del.status).toBe(404);
      await json(del);
      // Test avec le secret stocké : B n'a pas de secret stocké, A ne lui sert jamais.
      const test = await postTest(req("org-a", "/api/mail/account/test", "POST", testBody({ password: "" })));
      expect(test.status).toBe(400);
      expect((await json(test))?.code).toBe("password_required");
      // Mise à jour : l'écriture de B crée SA boîte et ne touche pas celle de A.
      await setAccount("org-a", ub, { address: "bob@example.fr", password: "autre-mot-de-passe" });

      const after = (await fx.pool.query("SELECT * FROM mail_accounts WHERE user_id = $1", [ua])).rows[0];
      expect(after).toEqual(before);
      expect(await fx.pool.query("SELECT 1 FROM mail_accounts WHERE user_id = $1", [ub])).toHaveProperty("rowCount", 1);
      // La lecture de A rend toujours la sienne.
      as(ua);
      const mine = await json(await getAccount(req("org-a", "/api/mail/account")));
      expect((mine?.account as { address: string }).address).toBe("me@example.fr");
    });

    it("a user of org B cannot reach the account routes of org A (404)", async () => {
      await setAccount("org-a", ua);
      as(uc);
      for (const res of [
        await getAccount(req("org-a", "/api/mail/account")),
        await putAccount(req("org-a", "/api/mail/account", "PUT", accountBody())),
        await deleteAccount(req("org-a", "/api/mail/account", "DELETE")),
        await postTest(req("org-a", "/api/mail/account/test", "POST", testBody())),
      ]) {
        expect(res.status).toBe(404);
        await json(res);
      }
      expect(await fx.pool.query("SELECT 1 FROM mail_accounts")).toHaveProperty("rowCount", 1);
    });
  });

  describe("envoi et lecture", () => {
    it("a user of org B cannot send from a fiche of org A", async () => {
      await setAccount("org-b", uc);
      as(uc);
      // Fiche de A depuis l'organisation de B : la fiche n'est pas lisible.
      const cross = await postMessage(req("org-b", "/api/mail/messages", "POST", composeBody(crmA.contacts, claire)));
      expect(cross.status).toBe(404);
      await json(cross);
      // Fiche de A en désignant l'organisation A : B n'en est pas membre.
      const wrongOrg = await postMessage(req("org-a", "/api/mail/messages", "POST", composeBody(crmA.contacts, claire)));
      expect(wrongOrg.status).toBe(404);
      await json(wrongOrg);
      expect(await count()).toBe(0);
      expect(h.sendMail).not.toHaveBeenCalled();
      // Contrôle : sur sa propre fiche, le même utilisateur peut programmer.
      const own = await postMessage(req("org-b", "/api/mail/messages", "POST", composeBody(crmB.contacts, bob)));
      expect(own.status).toBe(201);
      await json(own);
    });

    it("a mail row of org A never appears in the list of org B", async () => {
      await setAccount("org-a", ua);
      await setAccount("org-b", uc);
      as(ua);
      const sent = await postMessage(req("org-a", "/api/mail/messages", "POST", composeBody(crmA.contacts, claire)));
      expect(sent.status).toBe(201);
      const { id } = (await json(sent)) as { id: string };

      as(uc);
      const list = await listMessages(req("org-b", `/api/mail/messages?databaseId=${crmB.contacts}&rowId=${bob}`));
      expect(list.status).toBe(200);
      expect(await json(list)).toEqual({ conversations: [] });
      // La fiche de A n'est pas listable depuis B, ni le message lisible ou annulable.
      for (const res of [
        await listMessages(req("org-b", `/api/mail/messages?databaseId=${crmA.contacts}&rowId=${claire}`)),
        await getMessage(req("org-b", `/api/mail/messages/${id}`), params(id)),
        await cancelMessage(req("org-b", `/api/mail/messages/${id}/cancel`, "POST"), params(id)),
        await getContext(req("org-b", `/api/mail/context?databaseId=${crmA.contacts}&rowId=${claire}`)),
      ]) {
        expect(res.status).toBe(404);
        await json(res);
      }
      // Même requête directe sur la couche de données : filtre d'organisation.
      expect(await listFicheMails(orgB, uc, { kind: "contact", contactRowId: claire })).toEqual([]);
      expect((await fx.pool.query("SELECT status FROM mail_messages WHERE id = $1", [id])).rows[0].status).toBe("scheduled");
    });

    it("a colleague of the same org sees neither the thread nor the message of another user's mailbox", async () => {
      await setAccount("org-a", ua);
      await setAccount("org-a", ub, { address: "bob@example.fr" });
      as(ua);
      const sent = await postMessage(req("org-a", "/api/mail/messages", "POST", composeBody(crmA.contacts, claire)));
      const { id } = (await json(sent)) as { id: string };

      as(ub);
      const list = await listMessages(req("org-a", `/api/mail/messages?databaseId=${crmA.contacts}&rowId=${claire}`));
      expect(await json(list)).toEqual({ conversations: [] });
      for (const res of [
        await getMessage(req("org-a", `/api/mail/messages/${id}`), params(id)),
        await cancelMessage(req("org-a", `/api/mail/messages/${id}/cancel`, "POST"), params(id)),
      ]) {
        expect(res.status).toBe(404);
        await json(res);
      }
      expect((await fx.pool.query("SELECT status FROM mail_messages WHERE id = $1", [id])).rows[0].status).toBe("scheduled");
    });
  });

  describe("remise", () => {
    it("a cancelled mail is never delivered by the tick", async () => {
      await setAccount("org-a", ua);
      as(ua);
      const sent = await postMessage(req("org-a", "/api/mail/messages", "POST", composeBody(crmA.contacts, claire)));
      const { id } = (await json(sent)) as { id: string };
      const cancelled = await cancelMessage(req("org-a", `/api/mail/messages/${id}/cancel`, "POST"), params(id));
      expect(cancelled.status).toBe(200);
      await json(cancelled);

      // Échéance dépassée de longue date : le tick, la minuterie et un rattrapage ne le prennent pas.
      await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 hour' WHERE id = $1", [id]);
      await processDue();
      await mailingTick(new Date(Date.now() + 10 * 60_000));
      await mailingTick(new Date(Date.now() + 60 * 60_000));
      expect(h.sendMail).not.toHaveBeenCalled();
      const row = (await fx.pool.query("SELECT status, attempts, sent_at FROM mail_messages WHERE id = $1", [id])).rows[0];
      expect(row).toMatchObject({ status: "cancelled", attempts: 0, sent_at: null });
    });

    it("a due mail is delivered exactly once even when the timer and the tick race", async () => {
      await setAccount("org-a", ua);
      as(ua);
      const sent = await postMessage(req("org-a", "/api/mail/messages", "POST", composeBody(crmA.contacts, claire)));
      const { id } = (await json(sent)) as { id: string };
      await fx.pool.query("UPDATE mail_messages SET scheduled_at = now() - interval '1 second' WHERE id = $1", [id]);
      await Promise.all([processDue(), processDue(), mailingTick(), mailingTick()]);
      expect(h.sendMail).toHaveBeenCalledTimes(1);
      expect((await fx.pool.query("SELECT status FROM mail_messages WHERE id = $1", [id])).rows[0].status).toBe("sent");
    });
  });

  describe("no-secret-leak", () => {
    it("no JSON response of /api/mail/* carries passwordEnc or the mailbox password", async () => {
      await setAccount("org-a", ua);
      as(ua);
      const enc = (await fx.pool.query("SELECT password_enc FROM mail_accounts WHERE user_id = $1", [ua])).rows[0].password_enc as string;
      expect(enc).toBeTruthy();

      const sent = await postMessage(req("org-a", "/api/mail/messages", "POST", composeBody(crmA.contacts, claire)));
      const { id } = (await json(sent)) as { id: string };
      await json(await getAccount(req("org-a", "/api/mail/account")));
      await json(await putAccount(req("org-a", "/api/mail/account", "PUT", accountBody({ password: "••••••••" }))));
      await json(await putAccount(req("org-a", "/api/mail/account", "PUT", accountBody({ password: PASSWORD, smtpHost: "autre.example.fr" }))));
      await json(await postTest(req("org-a", "/api/mail/account/test", "POST", testBody())));
      await json(await postTest(req("org-a", "/api/mail/account/test", "POST", testBody({ password: "" }))));
      await json(await postTest(req("org-a", "/api/mail/account/test", "POST", testBody({ smtpHost: "ailleurs.example.fr", password: "" }))));
      await json(await listMessages(req("org-a", `/api/mail/messages?databaseId=${crmA.contacts}&rowId=${claire}`)));
      await json(await getMessage(req("org-a", `/api/mail/messages/${id}`), params(id)));
      await json(await getContext(req("org-a", `/api/mail/context?databaseId=${crmA.contacts}&rowId=${claire}`)));
      await json(await cancelMessage(req("org-a", `/api/mail/messages/${id}/cancel`, "POST"), params(id)));
      await json(await deleteAccount(req("org-a", "/api/mail/account", "DELETE")));

      const everything = JSON.stringify(seen);
      expect(seen.length).toBeGreaterThan(20);
      expect(everything).not.toContain("passwordEnc");
      expect(everything).not.toContain("password_enc");
      expect(everything).not.toContain(PASSWORD);
      expect(everything).not.toContain(enc);
      // Le journal d'audit ne reçoit pas non plus le secret.
      expect(JSON.stringify(h.audit.mock.calls)).not.toContain(PASSWORD);
      expect(JSON.stringify(h.audit.mock.calls)).not.toContain(enc);
    });
  });
});
