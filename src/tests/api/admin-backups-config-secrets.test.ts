/**
 * Non-régression sur `src/app/api/admin/backups/config/route.ts` (lot 6).
 *
 * La clé secrète du dépôt S3 des sauvegardes était gérée en direct par cette
 * route, hors du module partagé `@/lib/settings/secrets`. Deux conséquences,
 * toutes deux vérifiées ici :
 *
 *  1. la lecture rendait la valeur brute, alors que /api/admin/settings masque
 *     déjà le MEME champ : deux vues contradictoires du même secret ;
 *  2. l'écran forçait la clé secrète à la chaîne vide au chargement puis
 *     réémettait l'objet entier à l'enregistrement, et la route fusionnait sans
 *     passe de préservation. La chaîne vide était donc écrite et le secret du
 *     dépôt perdu, en silence, jusqu'à la prochaine sauvegarde.
 *
 * Le test central est l'ALLER-RETOUR : il porte sur la VALEUR ECRITE en base,
 * jamais sur le code de retour, qui valait déjà 200 quand le secret était
 * détruit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  encrypt: vi.fn((v: string) => `chiffre(${v})`),
  auditLog: vi.fn(),
  reloadBackupScheduler: vi.fn(async () => undefined),
  rows: [] as { key: string; value: unknown }[],
  written: [] as { key: string; value: unknown }[],
  insertCalls: { count: 0 },
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/crypto", () => ({ encrypt: h.encrypt }));
vi.mock("@/lib/audit/log", () => ({ auditLog: h.auditLog }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/backup/scheduler", () => ({
  reloadBackupScheduler: h.reloadBackupScheduler,
}));
vi.mock("@/lib/db/schema", () => ({ systemSettings: { key: "key" } }));
// `eq(systemSettings.key, "backup_s3")` devient un simple descripteur, que la
// doublure de `where` sait appliquer.
vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, value: string) => ({ key: value }),
}));
// Les interrupteurs de module ne sont pas le sujet ici : passe-plat.
vi.mock("@/lib/settings/module-toggles", () => ({
  stripModuleToggleFields: (_key: string, value: unknown) => ({
    skip: false,
    value,
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: (cond: { key: string }) =>
          Promise.resolve(h.rows.filter((r) => r.key === cond.key)),
      }),
    })),
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

import { GET, PUT } from "@/app/api/admin/backups/config/route";

const SENTINELLE = "••••••••";

const ADMIN_ORG = { id: "admin-org", email: "a@acme.tld", globalRole: "admin" };
const SUPER_ADMIN = { id: "sa", email: "sa@acme.tld", globalRole: "super_admin" };

/** Clé secrète du dépôt, chiffrée au repos (format iv:tag:cipher). */
const SECRET_CHIFFRE = `${"a".repeat(32)}:${"b".repeat(32)}:cleSecreteDepot`;

function seed() {
  h.rows = [
    {
      key: "backup_s3",
      value: {
        s3BackupEndpoint: "s3.acme.tld",
        s3BackupPort: "443",
        s3BackupRegion: "fr-par",
        s3BackupBucket: "sauvegardes",
        s3BackupAccessKey: "AKIAEXEMPLE",
        s3BackupSecretKey: SECRET_CHIFFRE,
        s3BackupUseSsl: true,
      },
    },
    {
      key: "backup_schedule",
      value: { clientCron: "0 2 * * *", technicalCron: "0 3 * * *", enabled: true },
    },
  ];
}

function put(body: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/admin/backups/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

/** Valeur réellement écrite en base pour la configuration du dépôt. */
function ecritS3(): Record<string, unknown> {
  const ligne = h.written.find((w) => w.key === "backup_s3");
  expect(ligne, "aucune écriture de `backup_s3`").toBeDefined();
  return ligne!.value as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  h.written = [];
  h.insertCalls.count = 0;
});

describe("GET /api/admin/backups/config : masquage de la clé secrète", () => {
  it("rend une sentinelle, jamais la clé secrète du dépôt", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const body = await (await GET()).json();

    expect(body.s3.s3BackupSecretKey).toBe(SENTINELLE);
    expect(JSON.stringify(body)).not.toContain("cleSecreteDepot");
  });

  it("laisse lisibles les champs non secrets, l'écran reste utilisable", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const body = await (await GET()).json();

    expect(body.s3.s3BackupEndpoint).toBe("s3.acme.tld");
    expect(body.s3.s3BackupBucket).toBe("sauvegardes");
    expect(body.s3.s3BackupAccessKey).toBe("AKIAEXEMPLE");
    expect(body.schedule.enabled).toBe(true);
  });

  it("laisse vide une clé secrète jamais renseignée (pas de fausse sentinelle)", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [
      { key: "backup_s3", value: { s3BackupBucket: "b", s3BackupSecretKey: "" } },
    ];
    const body = await (await GET()).json();
    expect(body.s3.s3BackupSecretKey).toBe("");
  });

  it("refuse la lecture à un administrateur d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/admin/backups/config : aller-retour lecture puis écriture", () => {
  it("ne détruit pas la clé secrète quand la sentinelle lue est réécrite", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    // 1. Lecture, exactement ce que reçoit l'écran des sauvegardes.
    const lu = await (await GET()).json();
    expect(lu.s3.s3BackupSecretKey).toBe(SENTINELLE);

    // 2. Réémission de l'objet entier, exactement ce que renvoie l'écran.
    const res = await put({ s3: lu.s3, schedule: lu.schedule });
    expect(res.status).toBe(200);

    // 3. La VALEUR ECRITE porte toujours le secret d'origine.
    const ecrit = ecritS3();
    expect(ecrit.s3BackupSecretKey).toBe(SECRET_CHIFFRE);
    expect(ecrit.s3BackupSecretKey).not.toBe(SENTINELLE);
    // La sentinelle n'a surtout pas été chiffrée puis stockée.
    expect(h.encrypt).not.toHaveBeenCalled();
    // Les champs modifiables restent écrits.
    expect(ecrit.s3BackupEndpoint).toBe("s3.acme.tld");
  });

  it("conserve la clé secrète quand l'écran envoie une chaîne vide", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const res = await put({
      s3: {
        s3BackupEndpoint: "s3.acme.tld",
        s3BackupBucket: "sauvegardes",
        s3BackupSecretKey: "",
      },
    });
    expect(res.status).toBe(200);
    expect(ecritS3().s3BackupSecretKey).toBe(SECRET_CHIFFRE);
  });

  it("conserve la clé secrète quand le client envoie `null`", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const res = await put({
      s3: { s3BackupBucket: "sauvegardes", s3BackupSecretKey: null },
    });
    expect(res.status).toBe(200);

    const ecrit = ecritS3();
    expect(ecrit).toHaveProperty("s3BackupSecretKey");
    expect(ecrit.s3BackupSecretKey).toBe(SECRET_CHIFFRE);
  });

  it("accepte quand même la rotation par une vraie valeur, et la chiffre", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const res = await put({ s3: { s3BackupSecretKey: "nouvelleCleSecrete" } });
    expect(res.status).toBe(200);

    expect(ecritS3().s3BackupSecretKey).toBe("chiffre(nouvelleCleSecrete)");
    expect(h.encrypt).toHaveBeenCalledTimes(1);
  });

  it("n'invente pas de secret quand aucun n'est stocké", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    h.rows = [];

    const res = await put({
      s3: { s3BackupBucket: "sauvegardes", s3BackupSecretKey: SENTINELLE },
    });
    expect(res.status).toBe(200);

    expect(ecritS3()).not.toHaveProperty("s3BackupSecretKey");
  });

  it("refuse l'écriture à un administrateur d'organisation, et n'écrit rien", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({ s3: { s3BackupSecretKey: "vole" } });

    expect(res.status).toBe(403);
    expect(h.insertCalls.count).toBe(0);
    expect(h.written).toHaveLength(0);
  });
});
