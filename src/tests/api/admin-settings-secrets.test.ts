/**
 * Non-régression sur `src/app/api/admin/settings/route.ts` (audit du
 * 2026-08-19, constat AZ-08).
 *
 * Le `GET` renvoyait TOUTES les lignes de `system_settings` en clair à tout
 * `globalRole=admin` : l'administrateur d'une seule organisation lisait les
 * identifiants SMTP, le compte de service LDAP et le couple clé/secret
 * LiveKit de l'instance, puis les remplaçait. Tous les courriels de tous les
 * tenants, liens de réinitialisation de mot de passe compris, partaient alors
 * par son relais.
 *
 * Deux gestes vérifiés ici :
 *  1. les clés d'INFRASTRUCTURE sont réservées à `super_admin`, en lecture
 *     comme en écriture, et le refus d'écriture est ATOMIQUE (« répond 403 ET
 *     ne fait rien », prouvé par le non-appel de `db.insert`) ;
 *  2. les SECRETS ne se relisent pas : la lecture rend une sentinelle.
 *
 * Le test le plus important est celui de l'ALLER-RETOUR : l'écran
 * d'administration lit les réglages puis les réécrit tels quels. Si l'écriture
 * acceptait la sentinelle, le premier enregistrement détruirait le secret réel
 * en le remplaçant par des puces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  encrypt: vi.fn((v: string) => `chiffre(${v})`),
  auditLog: vi.fn(),
  rows: [] as { key: string; value: unknown }[],
  written: [] as { key: string; value: unknown }[],
  insertCalls: { count: 0 },
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/crypto", () => ({ encrypt: h.encrypt }));
vi.mock("@/lib/audit/log", () => ({ auditLog: h.auditLog }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/db/schema", () => ({ systemSettings: { key: "key" } }));
// Les interrupteurs de module ne sont pas le sujet ici : passe-plat, pour ne
// pas embarquer tout le registre des modules dans ce test.
vi.mock("@/lib/settings/module-toggles", () => ({
  stripModuleToggleFields: (_key: string, value: unknown) => ({
    skip: false,
    value,
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: () => Promise.resolve(h.rows) })),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return {
        values: (v: { key: string; value: unknown }) => {
          h.written.push(v);
          return { onConflictDoUpdate: () => Promise.resolve(undefined) };
        },
      };
    }),
  },
}));

import { GET, PUT } from "@/app/api/admin/settings/route";

const SENTINELLE = "••••••••";

/** Administrateur d'une organisation : rôle global `admin`, pas d'instance. */
const ADMIN_ORG = { id: "admin-org", email: "a@acme.tld", globalRole: "admin" };
/** Administration d'instance. */
const SUPER_ADMIN = { id: "sa", email: "sa@acme.tld", globalRole: "super_admin" };

/** Secret LDAP déjà chiffré au repos (format iv:tag:cipher). */
const LDAP_CHIFFRE = `${"a".repeat(32)}:${"b".repeat(32)}:ldapsecret`;

function seed() {
  h.rows = [
    { key: "general", value: { appName: "LorIAx", appUrl: "https://acme.tld" } },
    {
      key: "ldap",
      value: {
        ldapUrl: "ldap://annuaire.interne",
        ldapBindDn: "cn=service,dc=acme",
        ldapBindPassword: LDAP_CHIFFRE,
      },
    },
    {
      key: "livekit",
      value: {
        livekitUrl: "wss://media.acme.tld",
        livekitApiKey: "APIcleReelle",
        livekitApiSecret: "secretLiveKitReel",
      },
    },
    { key: "auth", value: { allowRegistration: true, defaultRole: "viewer" } },
    { key: "rolePermissions", value: { viewer: { canCreateSpaces: false } } },
    // Clé hors périmètre de cet écran : ne doit jamais sortir.
    { key: "license", value: { jwt: "eyJhbGciOi..." } },
  ];
}

function put(body: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  h.written = [];
  h.insertCalls.count = 0;
});

describe("GET /api/admin/settings : cloisonnement des clés d'infrastructure", () => {
  it("ne rend aucune clé d'infrastructure à un admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const body = await (await GET()).json();

    for (const cle of ["ldap", "livekit", "auth", "smtp", "email"]) {
      expect(body).not.toHaveProperty(cle);
    }
    // Les clés non sensibles restent lisibles : l'écran n'est pas cassé.
    expect(body.general).toEqual({ appName: "LorIAx", appUrl: "https://acme.tld" });
    expect(body.rolePermissions).toBeDefined();
  });

  it("ne rend jamais les clés hors périmètre de l'écran (licence)", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const body = await (await GET()).json();
    expect(body).not.toHaveProperty("license");
  });

  it("refuse 403 à un utilisateur sans rôle admin, et ne lit rien", async () => {
    h.getSessionUser.mockResolvedValue({ id: "u", globalRole: "editor" });
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/settings : masquage des secrets", () => {
  it("masque le mot de passe de service LDAP, même pour l'administration d'instance", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const body = await (await GET()).json();

    expect(body.ldap.ldapBindPassword).toBe(SENTINELLE);
    // La valeur réelle, chiffrée ou non, ne transite jamais.
    expect(JSON.stringify(body)).not.toContain("ldapsecret");
    // Les champs non secrets restent lisibles, l'écran doit rester utilisable.
    expect(body.ldap.ldapUrl).toBe("ldap://annuaire.interne");
    expect(body.ldap.ldapBindDn).toBe("cn=service,dc=acme");
  });

  it("masque la clé et le secret LiveKit, stockés pourtant en clair", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const body = await (await GET()).json();

    expect(body.livekit.livekitApiKey).toBe(SENTINELLE);
    expect(body.livekit.livekitApiSecret).toBe(SENTINELLE);
    expect(JSON.stringify(body)).not.toContain("secretLiveKitReel");
    expect(JSON.stringify(body)).not.toContain("APIcleReelle");
  });

  it("laisse vide un secret jamais renseigné (pas de fausse sentinelle)", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [{ key: "smtp", value: { smtpHost: "mail.acme.tld", smtpPassword: "" } }];
    const body = await (await GET()).json();
    expect(body.smtp.smtpPassword).toBe("");
  });
});

describe("PUT /api/admin/settings : écriture d'infrastructure réservée à l'instance", () => {
  it("refuse 403 avec un message lisible et n'écrit RIEN", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      ldap: { ldapUrl: "ldap://pirate", ldapBindPassword: "vole" },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Action réservée à l'administration d'instance");
    expect(body.keys).toEqual(["ldap"]);
    expect(h.insertCalls.count).toBe(0);
    expect(h.written).toHaveLength(0);
  });

  it("refuse le détournement du relais de messagerie de l'instance", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      email: { smtpHost: "relais.pirate.tld", smtpPassword: "p" },
    });
    expect(res.status).toBe(403);
    expect(h.insertCalls.count).toBe(0);
  });

  it("refuse EN BLOC : une clé licite du même corps n'est pas écrite non plus", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      general: { appName: "Renommé" },
      auth: { allowRegistration: true },
    });

    expect(res.status).toBe(403);
    expect(h.insertCalls.count).toBe(0);
    expect(h.written.map((w) => w.key)).not.toContain("general");
  });

  it("laisse l'admin d'organisation écrire les clés non sensibles", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({ general: { appName: "Renommé" } });

    expect(res.status).toBe(200);
    expect(h.written.map((w) => w.key)).toEqual(["general"]);
  });

  it("laisse l'administration d'instance écrire les clés d'infrastructure", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const res = await put({ ldap: { ldapUrl: "ldap://neuf" } });

    expect(res.status).toBe(200);
    expect(h.written.map((w) => w.key)).toEqual(["ldap"]);
  });
});

describe("PUT /api/admin/settings : aller-retour lecture puis écriture", () => {
  /**
   * Le piège du correctif. L'écran d'administration charge les réglages via
   * GET, les place dans son état local, puis renvoie cet état tel quel au
   * premier « Enregistrer ». Si l'écriture prenait la sentinelle pour une
   * nouvelle valeur, le secret réel serait détruit sans que personne ne s'en
   * aperçoive avant la prochaine authentification LDAP.
   */
  it("ne détruit pas le secret LDAP quand la sentinelle lue est réécrite", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    // 1. Lecture, exactement ce que reçoit l'écran.
    const lu = await (await GET()).json();
    expect(lu.ldap.ldapBindPassword).toBe(SENTINELLE);

    // 2. Réécriture à l'identique, exactement ce que renvoie l'écran.
    const res = await put({ ldap: lu.ldap });
    expect(res.status).toBe(200);

    // 3. La valeur écrite en base porte toujours le secret d'origine.
    const ecrit = h.written.find((w) => w.key === "ldap")!
      .value as Record<string, unknown>;
    expect(ecrit.ldapBindPassword).toBe(LDAP_CHIFFRE);
    expect(ecrit.ldapBindPassword).not.toBe(SENTINELLE);
    // Et la sentinelle n'a surtout pas été chiffrée puis stockée.
    expect(h.encrypt).not.toHaveBeenCalled();
    // Les champs réellement modifiables restent écrits.
    expect(ecrit.ldapUrl).toBe("ldap://annuaire.interne");
  });

  it("ne détruit pas les secrets LiveKit, non chiffrés au repos", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const lu = await (await GET()).json();
    const res = await put({ livekit: { ...lu.livekit, livekitUrl: "wss://neuf" } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "livekit")!
      .value as Record<string, unknown>;
    expect(ecrit.livekitApiKey).toBe("APIcleReelle");
    expect(ecrit.livekitApiSecret).toBe("secretLiveKitReel");
    expect(ecrit.livekitUrl).toBe("wss://neuf");
  });

  it("accepte quand même la rotation d'un secret par une valeur réelle", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const res = await put({
      livekit: { livekitApiSecret: "nouveauSecretLiveKit" },
    });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "livekit")!
      .value as Record<string, unknown>;
    expect(ecrit.livekitApiSecret).toBe("nouveauSecretLiveKit");
  });

  /**
   * L'invariant « une valeur masquée ou vide ne remplace JAMAIS un secret
   * existant » ne valait que pour les chaînes de caractères : la passe de
   * préservation ignorait toute autre forme. Or `null` a un sens particulier à
   * la fusion, il SUPPRIME le champ. Un client qui envoyait `null` effaçait
   * donc le secret, sans message et sans retour possible.
   */
  it("ne détruit pas un secret reçu à `null` (la fusion supprimerait le champ)", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const res = await put({
      ldap: { ldapUrl: "ldap://annuaire.interne", ldapBindPassword: null },
    });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "ldap")!
      .value as Record<string, unknown>;
    expect(ecrit).toHaveProperty("ldapBindPassword");
    expect(ecrit.ldapBindPassword).toBe(LDAP_CHIFFRE);
  });

  it("ne détruit pas non plus un secret reçu sous une forme inattendue", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const res = await put({ livekit: { livekitApiSecret: 0, livekitApiKey: false } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "livekit")!
      .value as Record<string, unknown>;
    expect(ecrit.livekitApiSecret).toBe("secretLiveKitReel");
    expect(ecrit.livekitApiKey).toBe("APIcleReelle");
  });

  it("chiffre une rotation de secret LDAP, sans re-chiffrer l'existant", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const res = await put({ ldap: { ldapBindPassword: "nouveauMotDePasse" } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "ldap")!
      .value as Record<string, unknown>;
    expect(ecrit.ldapBindPassword).toBe("chiffre(nouveauMotDePasse)");
    expect(h.encrypt).toHaveBeenCalledTimes(1);
  });
});

describe("PUT /api/admin/settings : clé de messagerie héritée `smtp` et clé actuelle `email`", () => {
  /**
   * Le trou destructeur du lot 6.
   *
   * Le relais de messagerie existe sous deux clés : `smtp`, forme héritée, et
   * `email`, forme actuelle. L'écran des courriels LIT en repli sur `smtp`
   * quand `email` n'existe pas encore, mais il ECRIT toujours sous `email`.
   * La passe de préservation cherchait le secret sous la seule clé écrite : la
   * ligne `email` n'existant pas, le champ n'était trouvé nulle part, il était
   * supprimé, et la ligne `email` naissait SANS mot de passe. Le fournisseur
   * de courriel privilégiant `email` dès qu'elle existe, l'instance perdait
   * son relais, liens de réinitialisation de mot de passe compris, et le
   * secret n'était plus récupérable depuis l'interface.
   */
  const MOT_DE_PASSE_SMTP = `${"c".repeat(32)}:${"d".repeat(32)}:motDePasseRelais`;
  /** Mot de passe de la clé actuelle `email`, chiffré au repos lui aussi. */
  const MOT_DE_PASSE_EMAIL = `${"e".repeat(32)}:${"f".repeat(32)}:motDePasseActuel`;

  /** Base d'une instance jamais migrée : seule la clé héritée existe. */
  function seedHeritee() {
    h.rows = [
      {
        key: "smtp",
        value: {
          smtpEnabled: true,
          smtpHost: "mail.acme.tld",
          smtpPort: 587,
          smtpUser: "relais@acme.tld",
          smtpPassword: MOT_DE_PASSE_SMTP,
          smtpFrom: "no-reply@acme.tld",
          smtpSecure: false,
        },
      },
    ];
  }

  it("conserve le mot de passe hérité quand l'écran enregistre sous `email`", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    seedHeritee();

    // 1. Lecture : pas de clé `email`, l'écran retombe sur `smtp` et reçoit la
    //    sentinelle à la place du mot de passe.
    const lu = await (await GET()).json();
    expect(lu.email).toBeUndefined();
    expect(lu.smtp.smtpPassword).toBe(SENTINELLE);

    // 2. Enregistrement, exactement le corps que l'écran des courriels envoie.
    const res = await put({
      email: {
        emailProvider: "smtp",
        smtpHost: lu.smtp.smtpHost,
        smtpPort: String(lu.smtp.smtpPort),
        smtpUser: lu.smtp.smtpUser,
        smtpPassword: lu.smtp.smtpPassword,
        smtpFrom: lu.smtp.smtpFrom,
        smtpSecure: lu.smtp.smtpSecure,
      },
    });
    expect(res.status).toBe(200);

    // 3. La ligne `email` créée PORTE le mot de passe d'origine.
    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe(MOT_DE_PASSE_SMTP);
    expect(ecrit.smtpPassword).not.toBe(SENTINELLE);
    expect(ecrit).toHaveProperty("smtpPassword");
    // Le secret repris n'est pas re-chiffré : il l'était déjà au repos.
    expect(h.encrypt).not.toHaveBeenCalled();
    // Les champs non secrets suivent bien la migration.
    expect(ecrit.smtpHost).toBe("mail.acme.tld");
    expect(ecrit.smtpUser).toBe("relais@acme.tld");
  });

  it("reprend aussi un mot de passe hérité stocké en clair, et le chiffre", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [
      { key: "smtp", value: { smtpHost: "mail.acme.tld", smtpPassword: "enClair" } },
    ];

    const res = await put({
      email: { emailProvider: "smtp", smtpHost: "mail.acme.tld", smtpPassword: "" },
    });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe("chiffre(enClair)");
  });

  it("laisse la clé `email` primer sur la clé héritée quand les deux existent", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [
      { key: "smtp", value: { smtpPassword: "ancienMotDePasse" } },
      {
        key: "email",
        value: { smtpHost: "mail.acme.tld", smtpPassword: MOT_DE_PASSE_EMAIL },
      },
    ];

    const res = await put({
      email: { smtpHost: "mail.acme.tld", smtpPassword: SENTINELLE },
    });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe(MOT_DE_PASSE_EMAIL);
  });

  it("traite le cas symétrique : écrire sous `smtp` reprend le secret de `email`", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [
      {
        key: "email",
        value: { smtpHost: "mail.acme.tld", smtpPassword: MOT_DE_PASSE_EMAIL },
      },
    ];

    const res = await put({ smtp: { smtpHost: "mail.acme.tld", smtpPassword: SENTINELLE } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "smtp")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe(MOT_DE_PASSE_EMAIL);
  });

  it("n'invente pas de secret quand aucune des deux clés n'en porte", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [];

    const res = await put({
      email: { emailProvider: "smtp", smtpHost: "mail.acme.tld", smtpPassword: SENTINELLE },
    });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit).not.toHaveProperty("smtpPassword");
  });

  it("accepte la rotation par une vraie valeur, sans repli sur la clé héritée", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    seedHeritee();

    const res = await put({
      email: { smtpHost: "mail.acme.tld", smtpPassword: "nouveauMotDePasse" },
    });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe("chiffre(nouveauMotDePasse)");
  });
  /**
   * Le champ ABSENT du corps reçu, angle mort du repli sur la clé jumelle.
   *
   * La passe de préservation court-circuitait ce cas au motif que « la fusion a
   * déjà conservé la valeur ». C'est vrai de la clé écrite, et faux de sa clé
   * jumelle : la fusion ne connaît que la ligne `email`, qui n'existe pas
   * encore. Le repli hérité, ajouté précisément pour ce scénario, n'était donc
   * jamais joué et la ligne `email` naissait sans mot de passe.
   */
  it("reprend le secret hérité même quand le corps n'envoie PAS le champ", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    seedHeritee();

    // Corps d'un écran qui n'expose pas le champ mot de passe (bascule de
    // fournisseur, formulaire partiel) : `smtpPassword` est absent, pas vide.
    const res = await put({
      email: { emailProvider: "smtp", smtpHost: "mail.acme.tld", smtpUser: "relais@acme.tld" },
    });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe(MOT_DE_PASSE_SMTP);
  });

  it("traite le cas symétrique du champ absent : écrire `smtp` reprend `email`", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [
      {
        key: "email",
        value: { smtpHost: "mail.acme.tld", smtpPassword: MOT_DE_PASSE_EMAIL },
      },
    ];

    const res = await put({ smtp: { smtpHost: "mail.acme.tld" } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "smtp")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe(MOT_DE_PASSE_EMAIL);
  });

  it("garde le secret de la clé écrite quand le champ est absent (pas de régression)", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [
      {
        key: "email",
        value: { smtpHost: "mail.acme.tld", smtpPassword: MOT_DE_PASSE_EMAIL },
      },
    ];

    const res = await put({ email: { smtpHost: "relais2.acme.tld" } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit.smtpPassword).toBe(MOT_DE_PASSE_EMAIL);
    expect(ecrit.smtpHost).toBe("relais2.acme.tld");
    // Le secret repris est déjà chiffré au repos : aucun re-chiffrement.
    expect(h.encrypt).not.toHaveBeenCalled();
  });

  it("n'invente aucun champ quand il est absent et qu'aucune clé n'en porte", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [];

    const res = await put({ email: { emailProvider: "resend" } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "email")!
      .value as Record<string, unknown>;
    expect(ecrit).not.toHaveProperty("smtpPassword");
    expect(ecrit).not.toHaveProperty("resendApiKey");
  });
});
