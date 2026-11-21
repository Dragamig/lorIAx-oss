/**
 * Non-régression sur les trois routes de test de connexion de
 * l'administration (audit du 2026-08-19, constat AZ-08, porte dérobée relevée
 * au lot 6) :
 *   - `src/app/api/admin/settings/smtp-test/route.ts`
 *   - `src/app/api/admin/settings/resend-test/route.ts`
 *   - `src/app/api/admin/settings/ldap-test/route.ts`
 *
 * Le correctif AZ-08 retire à l'administrateur d'organisation la LECTURE et
 * l'ÉCRITURE des clés `email`, `smtp` et `ldap`. Ces trois routes lui en
 * laissaient l'EXERCICE : elles ouvrent une connexion sortante avec les
 * identifiants d'instance stockés en base, et rendent le verdict. C'est un
 * oracle sur une configuration qu'il n'a pas le droit de voir (le relais
 * existe-t-il, l'authentification passe-t-elle, quelle est l'adresse
 * d'expédition), et pour SMTP et Resend un envoi réel de courriel par le
 * relais partagé de tous les tenants.
 *
 * Vérifié ici : refus 403 pour l'administrateur d'organisation, ET aucune
 * connexion sortante tentée (ni lecture de la configuration, ni vérification,
 * ni envoi, ni liaison à l'annuaire). Le code de retour seul ne prouverait
 * rien : l'oracle serait déjà consommé.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getEmailConfig: vi.fn(),
  verifySmtp: vi.fn(),
  verifyResend: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  resendConstructor: vi.fn(),
  resendSend: vi.fn(),
  testLdapConnection: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/email/provider", () => ({
  getEmailConfig: h.getEmailConfig,
  verifySmtp: h.verifySmtp,
  verifyResend: h.verifyResend,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: h.createTransport },
  createTransport: h.createTransport,
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: h.resendSend };
    constructor(cle: string) {
      h.resendConstructor(cle);
    }
  },
}));
vi.mock("@/lib/auth/ldap", () => ({ testLdapConnection: h.testLdapConnection }));

import { POST as smtpTest } from "@/app/api/admin/settings/smtp-test/route";
import { POST as resendTest } from "@/app/api/admin/settings/resend-test/route";
import { POST as ldapTest } from "@/app/api/admin/settings/ldap-test/route";

/** Administrateur d'une organisation : rôle global `admin`, pas d'instance. */
const ADMIN_ORG = { id: "admin-org", email: "a@acme.tld", globalRole: "admin" };
/** Administration d'instance. */
const SUPER_ADMIN = { id: "sa", email: "sa@acme.tld", globalRole: "super_admin" };

beforeEach(() => {
  vi.clearAllMocks();
  h.createTransport.mockReturnValue({ sendMail: h.sendMail });
  h.sendMail.mockResolvedValue({ messageId: "1" });
  h.resendSend.mockResolvedValue({ error: null });
  h.getEmailConfig.mockResolvedValue({
    emailEnabled: true,
    smtpHost: "relais.interne",
    smtpUser: "service",
    smtpPassword: "motDePasseRelais",
    smtpFrom: "LorIAx <no-reply@acme.tld>",
    resendApiKey: "re_cleReelle",
    resendFrom: "LorIAx <no-reply@acme.tld>",
  });
  h.testLdapConnection.mockResolvedValue({ success: true });
});

/** Aucune des routes ne doit avoir ouvert quoi que ce soit vers l'extérieur. */
function aucuneConnexionSortante() {
  expect(h.getEmailConfig).not.toHaveBeenCalled();
  expect(h.verifySmtp).not.toHaveBeenCalled();
  expect(h.verifyResend).not.toHaveBeenCalled();
  expect(h.createTransport).not.toHaveBeenCalled();
  expect(h.sendMail).not.toHaveBeenCalled();
  expect(h.resendConstructor).not.toHaveBeenCalled();
  expect(h.resendSend).not.toHaveBeenCalled();
  expect(h.testLdapConnection).not.toHaveBeenCalled();
}

describe("POST /api/admin/settings/smtp-test", () => {
  it("refuse 403 à un admin d'organisation et ne tente aucune connexion", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await smtpTest();

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Action réservée à l'administration d'instance");
    // Ni le mot de passe du relais ni son hôte ne transitent dans le refus.
    expect(JSON.stringify(body)).not.toContain("motDePasseRelais");
    expect(JSON.stringify(body)).not.toContain("relais.interne");
    aucuneConnexionSortante();
  });

  it("refuse 403 sans session", async () => {
    h.getSessionUser.mockResolvedValue(null);
    expect((await smtpTest()).status).toBe(403);
    aucuneConnexionSortante();
  });

  it("laisse l'administration d'instance exercer le test", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const res = await smtpTest();

    expect(res.status).toBe(200);
    expect(h.verifySmtp).toHaveBeenCalledTimes(1);
    expect(h.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/settings/resend-test", () => {
  it("refuse 403 à un admin d'organisation et ne tente aucune connexion", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await resendTest();

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Action réservée à l'administration d'instance");
    // La clé d'API de l'instance ne fuit pas, et n'est même pas lue.
    expect(JSON.stringify(body)).not.toContain("re_cleReelle");
    aucuneConnexionSortante();
  });

  it("laisse l'administration d'instance exercer le test", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const res = await resendTest();

    expect(res.status).toBe(200);
    expect(h.verifyResend).toHaveBeenCalledTimes(1);
    expect(h.resendSend).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/settings/ldap-test", () => {
  it("refuse 403 à un admin d'organisation et ne lie pas l'annuaire", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await ldapTest();

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Action réservée à l'administration d'instance");
    aucuneConnexionSortante();
  });

  it("ne renseigne pas l'admin d'organisation sur l'échec de l'annuaire", async () => {
    // Un message d'échec détaillé vaudrait oracle sur l'hôte de l'annuaire.
    h.testLdapConnection.mockResolvedValue({
      success: false,
      error: "connexion refusée par annuaire.interne:389",
    });
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await ldapTest();

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("annuaire.interne");
    aucuneConnexionSortante();
  });

  it("laisse l'administration d'instance exercer le test", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const res = await ldapTest();

    expect(res.status).toBe(200);
    expect(h.testLdapConnection).toHaveBeenCalledTimes(1);
  });
});
