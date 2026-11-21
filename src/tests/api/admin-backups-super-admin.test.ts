/**
 * Non-régression sur `src/app/api/admin/backups/**` (audit du 2026-08-19,
 * constat AZ-07).
 *
 * Ces routes se contentaient d'exiger `hasGlobalRole(user.globalRole, "admin")`
 * et ne filtraient jamais `backup_jobs` par organisation. Or une sauvegarde
 * LorIAx est un dump PostgreSQL de l'instance entière, tous tenants confondus :
 * `download` rendait une URL S3 présignée vers ce dump à partir de n'importe
 * quel `jobId`, et `restore` permettait d'écraser la base complète. Un simple
 * administrateur d'organisation disposait donc des données de toutes les
 * autres, et d'un levier de destruction globale.
 *
 * Correctif : tout le dossier passe à `super_admin`, avec le message de refus
 * partagé `INSTANCE_ADMIN_ONLY_MESSAGE` (arbitrage du mainteneur du 2026-08-20 :
 * pas de refonte des écrans, mais un refus qui se lit).
 *
 * Motif de vérification : « répond 403 ET ne fait rien ». L'absence d'effet est
 * prouvée par les mocks : aucune lecture de `backup_jobs`, aucune insertion,
 * aucun appel à `getSignedUrl`, à `spawn` (pg_restore) ni à `runBackupAsync`.
 *
 * ATTENTION, propriété du HARNAIS, pas des routes : chaque test de refus arme
 * d'abord le jeu de données COMPLET dont l'ancien code avait besoin pour aller
 * au bout de son travail (tâche de sauvegarde existante, terminée, munie de sa
 * clé S3, mot de passe vérifiable, client S3 disponible). Sans cela, l'ancien
 * code refusait déjà pour une autre raison (« sauvegarde introuvable », 404) et
 * le test ne prouvait rien. Chaque refus est doublé d'un témoin en
 * `super_admin` qui, sur EXACTEMENT le même jeu de données, va au bout : c'est
 * la preuve que le refus vient du rôle et non d'un décor incomplet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Readable } from "stream";
import { INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSignedUrl: vi.fn(),
  createBackupS3Client: vi.fn(),
  testBackupS3Connection: vi.fn(),
  getBackupS3Config: vi.fn(),
  runBackupAsync: vi.fn(),
  spawn: vi.fn(),
  bcryptCompare: vi.fn(),
  auditLog: vi.fn(),
  reloadBackupScheduler: vi.fn(),
  s3Send: vi.fn(),
  pipeline: vi.fn(),
  writeFile: vi.fn(),
  selectQueue: [] as unknown[][],
  selectCalls: { count: 0 },
  insertCalls: { count: 0 },
  updateCalls: { count: 0 },
  deleteCalls: { count: 0 },
}));

/** Promesse de lignes qui accepte encore `.limit()` et `.offset()`. */
function paginable(rows: unknown[]) {
  const p = Promise.resolve(rows) as Promise<unknown[]> & {
    limit: () => ReturnType<typeof paginable>;
    offset: () => ReturnType<typeof paginable>;
  };
  p.limit = () => paginable(rows);
  p.offset = () => paginable(rows);
  return p;
}

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn(() => paginable(rows)),
    limit: vi.fn().mockResolvedValue(rows),
    offset: vi.fn().mockResolvedValue(rows),
    returning: vi.fn().mockResolvedValue(rows),
    // Une requête close par `.where(...)`, sans `limit` ni `orderBy`, s'attend
    // directement. Sans ce `then`, l'ancien code plantait sur la
    // déstructuration au lieu de rendre sa réponse, et le test aurait mesuré un
    // plantage de décor au lieu d'un refus.
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectQueue[h.selectCalls.count] ?? [];
      h.selectCalls.count += 1;
      return chain(rows);
    }),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return chain([{ id: "job-neuf" }]);
    }),
    update: vi.fn(() => {
      h.updateCalls.count += 1;
      return chain([]);
    }),
    delete: vi.fn(() => {
      h.deleteCalls.count += 1;
      return chain([]);
    }),
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: h.getSignedUrl }));
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock("@/lib/backup/s3-backup", () => ({
  createBackupS3Client: h.createBackupS3Client,
  testBackupS3Connection: h.testBackupS3Connection,
  getBackupS3Config: h.getBackupS3Config,
}));
vi.mock("@/lib/backup/runner", () => ({ runBackupAsync: h.runBackupAsync }));
vi.mock("@/lib/backup/scheduler", () => ({ reloadBackupScheduler: h.reloadBackupScheduler }));
vi.mock("child_process", () => ({ spawn: h.spawn }));
vi.mock("bcryptjs", () => ({ default: { compare: h.bcryptCompare } }));
vi.mock("@/lib/audit/log", () => ({ auditLog: h.auditLog }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1" }));
// Seules les quatre entrées utilisées par la restauration sont détournées : le
// reste du module `fs` est celui de Node, pour ne casser aucun autre import.
vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs")>()),
  mkdtempSync: () => "/tmp/loriax-restore-test",
  chmodSync: () => undefined,
  rmSync: () => undefined,
  createWriteStream: () => ({}) as unknown,
  writeFileSync: (...args: unknown[]) => h.writeFile(...args),
}));
vi.mock("stream/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("stream/promises")>()),
  pipeline: (...args: unknown[]) => h.pipeline(...args),
}));

import { GET as downloadGet } from "@/app/api/admin/backups/download/route";
import { POST as restorePost } from "@/app/api/admin/backups/restore/route";
import { POST as triggerPost } from "@/app/api/admin/backups/trigger/route";
import { GET as historyGet } from "@/app/api/admin/backups/history/route";
import { GET as statusGet } from "@/app/api/admin/backups/status/route";
import { GET as configGet, PUT as configPut } from "@/app/api/admin/backups/config/route";
import { POST as configTestPost } from "@/app/api/admin/backups/config/test/route";

/** Administrateur d'organisation : ne doit plus rien pouvoir ici. */
const ADMIN_ORG = { id: "admin-1", email: "admin@acme.tld", globalRole: "admin" };
/** Administration d'instance : seul rôle admis désormais. */
const SUPER_ADMIN = { id: "root-1", email: "root@example.com", globalRole: "super_admin" };

/** Un identifiant de sauvegarde parfaitement valide, qui ne doit pas suffire. */
const JOB_ID = "3f0d6f4c-6f3a-4d1e-9a1a-2b7c8d9e0f11";

/** URL présignée que l'ancien code rendait à qui la demandait. */
const URL_PRESIGNEE = "https://s3.example/loriax/dump-instance.sql.gz?signature=abc";

/** Une sauvegarde terminée, complète, réellement téléchargeable. */
const SAUVEGARDE_COMPLETE = {
  id: JOB_ID,
  type: "full",
  status: "completed",
  s3Key: "backups/2026-08-19/full.dump",
  s3Bucket: "loriax-backups",
  startedAt: new Date("2026-08-19T02:00:00Z"),
  finishedAt: new Date("2026-08-19T02:12:00Z"),
  triggeredBy: "root-1",
};

/**
 * Arme le décor du téléchargement : la tâche existe et le client S3 répond.
 * Sur ce décor, l'ancien code signait une URL.
 */
function armerTelechargement() {
  h.selectQueue.push([SAUVEGARDE_COMPLETE]);
  h.createBackupS3Client.mockResolvedValue({ client: { send: h.s3Send }, bucket: "loriax-backups" });
  h.getSignedUrl.mockResolvedValue(URL_PRESIGNEE);
}

/** Liste de contenu d'un dump 1.204.x : `attachments` y est encore. */
const TOC_DUMP = [
  "221; 1259 16400 TABLE public attachments loriax",
  "222; 1259 16410 TABLE public media loriax",
  "3401; 0 16400 TABLE DATA public attachments loriax",
  "3402; 0 16410 TABLE DATA public media loriax",
].join("\n");

/**
 * Faux `spawn` : le premier appel est `pg_restore -l` (liste sur stdout, code
 * `listCode`), le second la restauration (code 0).
 */
function armerSpawn(listCode: number) {
  h.spawn.mockImplementation((_cmd: string, args: string[]) => {
    const listage = args[0] === "-l";
    const code = listage ? listCode : 0;
    return {
      stdout: {
        on: (evenement: string, rappel: (chunk: Buffer) => void) => {
          if (listage && evenement === "data") rappel(Buffer.from(TOC_DUMP));
        },
      },
      stderr: { on: () => undefined },
      on: (evenement: string, rappel: (code: number) => void) => {
        if (evenement === "close") setImmediate(() => rappel(code));
      },
    };
  });
}

/**
 * Arme le décor de la restauration : mot de passe vérifiable, tâche complète,
 * dump téléchargeable et `pg_restore` qui se termine sans erreur.
 */
function armerRestauration() {
  h.selectQueue.push([{ passwordHash: "$2a$10$hachageValide" }]);
  h.selectQueue.push([SAUVEGARDE_COMPLETE]);
  h.bcryptCompare.mockResolvedValue(true);
  h.createBackupS3Client.mockResolvedValue({ client: { send: h.s3Send }, bucket: "loriax-backups" });
  h.s3Send.mockResolvedValue({ Body: Readable.from(["dump"]) });
  h.pipeline.mockResolvedValue(undefined);
  armerSpawn(0);
  process.env.DATABASE_URL = "postgres://loriax:secret@localhost:5432/loriax";
}

function requeteRestauration() {
  return new NextRequest("http://acme.example.com/api/admin/backups/restore", {
    method: "POST",
    body: JSON.stringify({ jobId: JOB_ID, confirmPassword: "motdepasse" }),
    headers: { "Content-Type": "application/json" },
  });
}

/** Arme le décor de l'historique : une page de résultats et son total. */
function armerHistorique() {
  h.selectQueue.push([SAUVEGARDE_COMPLETE]);
  h.selectQueue.push([{ total: 1 }]);
}

/** Arme le décor de l'état : une sauvegarde en cours et une dernière réussie. */
function armerEtat() {
  h.selectQueue.push([{ ...SAUVEGARDE_COMPLETE, status: "running" }]);
  h.selectQueue.push([SAUVEGARDE_COMPLETE]);
  h.selectQueue.push([SAUVEGARDE_COMPLETE]);
  h.selectQueue.push([SAUVEGARDE_COMPLETE]);
  h.getBackupS3Config.mockResolvedValue({ bucket: "loriax-backups" });
}

/** Arme le décor de la configuration : les deux réglages existent en base. */
function armerConfiguration() {
  h.selectQueue.push([{ key: "backup_s3", value: { s3BackupBucket: "loriax-backups" } }]);
  h.selectQueue.push([
    { key: "backup_schedule", value: { clientCron: "0 2 * * *", enabled: true } },
  ]);
}

/** Corps d'écriture de configuration, avec un détournement de bucket. */
const ECRITURE_CONFIG = {
  s3: { s3BackupBucket: "détourné" },
  schedule: { clientCron: "*/5 * * * *", technicalCron: "0 3 * * *", enabled: true },
};

function requeteConfigPut() {
  return new NextRequest("http://acme.example.com/api/admin/backups/config", {
    method: "PUT",
    body: JSON.stringify(ECRITURE_CONFIG),
    headers: { "Content-Type": "application/json" },
  });
}

function attendreAucunEffetDeBord() {
  expect(h.selectCalls.count).toBe(0);
  expect(h.insertCalls.count).toBe(0);
  expect(h.updateCalls.count).toBe(0);
  expect(h.deleteCalls.count).toBe(0);
  expect(h.getSignedUrl).not.toHaveBeenCalled();
  expect(h.createBackupS3Client).not.toHaveBeenCalled();
  expect(h.spawn).not.toHaveBeenCalled();
  expect(h.runBackupAsync).not.toHaveBeenCalled();
  expect(h.bcryptCompare).not.toHaveBeenCalled();
  expect(h.auditLog).not.toHaveBeenCalled();
  expect(h.testBackupS3Connection).not.toHaveBeenCalled();
  expect(h.getBackupS3Config).not.toHaveBeenCalled();
  expect(h.reloadBackupScheduler).not.toHaveBeenCalled();
}

async function attendreRefusExplicite(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(403);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.error).toBe(INSTANCE_ADMIN_ONLY_MESSAGE);
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.selectCalls.count = 0;
  h.insertCalls.count = 0;
  h.updateCalls.count = 0;
  h.deleteCalls.count = 0;
  h.getSessionUser.mockResolvedValue(ADMIN_ORG);
});

describe("Sauvegardes : un administrateur d'organisation est refusé (AZ-07)", () => {
  it("refuse le téléchargement ET ne signe aucune URL, sur une sauvegarde réellement téléchargeable", async () => {
    armerTelechargement();

    const res = await downloadGet(
      new NextRequest(`http://acme.example.com/api/admin/backups/download?jobId=${JOB_ID}`)
    );

    // Deux propriétés distinctes : le refus...
    const corps = await attendreRefusExplicite(res);
    // ...et l'absence de signature, sur un décor où la signature était possible.
    expect(h.getSignedUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(corps)).not.toContain(URL_PRESIGNEE);
    attendreAucunEffetDeBord();
  });

  it("refuse la restauration ET ne lance aucun pg_restore, sur une sauvegarde restaurable", async () => {
    armerRestauration();

    const res = await restorePost(
      new NextRequest("http://acme.example.com/api/admin/backups/restore", {
        method: "POST",
        body: JSON.stringify({ jobId: JOB_ID, confirmPassword: "motdepasse" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    await attendreRefusExplicite(res);
    // Le mot de passe n'est même pas vérifié, le dump n'est pas téléchargé,
    // `pg_restore` n'est pas lancé.
    expect(h.bcryptCompare).not.toHaveBeenCalled();
    expect(h.s3Send).not.toHaveBeenCalled();
    expect(h.spawn).not.toHaveBeenCalled();
    attendreAucunEffetDeBord();
  });

  it("refuse le déclenchement ET ne crée aucune tâche de sauvegarde", async () => {
    // Aucune sauvegarde du même type en cours : l'ancien code aurait inséré.
    h.selectQueue.push([]);
    h.runBackupAsync.mockResolvedValue(undefined);

    const res = await triggerPost(
      new NextRequest("http://acme.example.com/api/admin/backups/trigger", {
        method: "POST",
        body: JSON.stringify({ type: "full" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    await attendreRefusExplicite(res);
    expect(h.insertCalls.count).toBe(0);
    expect(h.runBackupAsync).not.toHaveBeenCalled();
    attendreAucunEffetDeBord();
  });

  it("refuse l'historique ET ne lit aucune tâche, alors que l'historique est peuplé", async () => {
    armerHistorique();

    const res = await historyGet(
      new NextRequest("http://acme.example.com/api/admin/backups/history")
    );

    const corps = await attendreRefusExplicite(res);
    expect(JSON.stringify(corps)).not.toContain(SAUVEGARDE_COMPLETE.s3Key);
    attendreAucunEffetDeBord();
  });

  it("refuse l'état ET ne lit ni les tâches en cours ni la configuration S3", async () => {
    armerEtat();

    const res = await statusGet();

    await attendreRefusExplicite(res);
    attendreAucunEffetDeBord();
  });

  it("refuse la lecture de configuration ET ne rend aucun réglage d'instance", async () => {
    armerConfiguration();

    const res = await configGet();

    const corps = await attendreRefusExplicite(res);
    expect(JSON.stringify(corps)).not.toContain("loriax-backups");
    attendreAucunEffetDeBord();
  });

  it("refuse l'écriture de configuration ET n'écrit rien, sur un corps parfaitement valide", async () => {
    h.selectQueue.push([{ key: "backup_s3", value: { s3BackupBucket: "loriax-backups" } }]);

    const res = await configPut(requeteConfigPut());

    await attendreRefusExplicite(res);
    expect(h.insertCalls.count).toBe(0);
    expect(h.updateCalls.count).toBe(0);
    expect(h.reloadBackupScheduler).not.toHaveBeenCalled();
    attendreAucunEffetDeBord();
  });

  it("refuse le test S3 ET ne contacte pas le stockage", async () => {
    h.testBackupS3Connection.mockResolvedValue({ ok: true, bucket: "loriax-backups" });

    const res = await configTestPost();

    await attendreRefusExplicite(res);
    expect(h.testBackupS3Connection).not.toHaveBeenCalled();
    attendreAucunEffetDeBord();
  });
});

describe("Sauvegardes : témoins, l'administration d'instance va au bout sur le même décor", () => {
  beforeEach(() => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
  });

  it("signe bien l'URL de téléchargement pour un super_admin", async () => {
    armerTelechargement();

    const res = await downloadGet(
      new NextRequest(`http://acme.example.com/api/admin/backups/download?jobId=${JOB_ID}`)
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ url: URL_PRESIGNEE });
    expect(h.getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("lance bien pg_restore pour un super_admin", async () => {
    armerRestauration();

    const res = await restorePost(
      new NextRequest("http://acme.example.com/api/admin/backups/restore", {
        method: "POST",
        body: JSON.stringify({ jobId: JOB_ID, confirmPassword: "motdepasse" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(200);
    expect(h.bcryptCompare).toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalledWith("pg_restore", expect.any(Array), expect.any(Object));
  });

  it("restaure avec la liste filtrée : pg_restore -l puis -L sans attachments", async () => {
    armerRestauration();

    const res = await restorePost(requeteRestauration());

    expect(res.status).toBe(200);
    expect(h.spawn).toHaveBeenCalledTimes(2);
    const [, argsListe] = h.spawn.mock.calls[0];
    expect(argsListe[0]).toBe("-l");
    const [, argsRestauration] = h.spawn.mock.calls[1];
    const i = argsRestauration.indexOf("-L");
    expect(i).toBeGreaterThan(-1);
    const [fichier, contenu] = h.writeFile.mock.calls[0];
    expect(argsRestauration[i + 1]).toBe(fichier);
    const actives = String(contenu).split("\n").filter((l) => /^\d/.test(l));
    expect(actives).toHaveLength(2);
    expect(actives.join("\n")).not.toContain("attachments");
    expect(String(contenu)).toContain(";221; 1259 16400 TABLE public attachments loriax");
  });

  it("répond 500 sans restaurer quand pg_restore -l échoue", async () => {
    armerRestauration();
    armerSpawn(1);

    const res = await restorePost(requeteRestauration());

    expect(res.status).toBe(500);
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it("laisse un super_admin déclencher une sauvegarde", async () => {
    h.runBackupAsync.mockResolvedValue(undefined);
    // Aucune sauvegarde du même type en cours.
    h.selectQueue.push([]);

    const res = await triggerPost(
      new NextRequest("http://acme.example.com/api/admin/backups/trigger", {
        method: "POST",
        body: JSON.stringify({ type: "full" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ jobId: "job-neuf" });
    expect(h.insertCalls.count).toBe(1);
    expect(h.runBackupAsync).toHaveBeenCalledWith("job-neuf", "full");
  });

  it("rend bien l'historique à un super_admin", async () => {
    armerHistorique();

    const res = await historyGet(
      new NextRequest("http://acme.example.com/api/admin/backups/history")
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: { s3Key: string }[] };
    expect(body.jobs[0].s3Key).toBe(SAUVEGARDE_COMPLETE.s3Key);
  });

  it("laisse un super_admin lire l'état des sauvegardes", async () => {
    armerEtat();

    const res = await statusGet();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { s3Configured: boolean; running: unknown[] };
    expect(body.s3Configured).toBe(true);
    expect(body.running).toHaveLength(1);
    expect(h.getBackupS3Config).toHaveBeenCalled();
  });

  it("rend bien la configuration à un super_admin", async () => {
    armerConfiguration();

    const res = await configGet();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { s3: { s3BackupBucket: string } };
    expect(body.s3.s3BackupBucket).toBe("loriax-backups");
  });

  it("écrit bien la configuration pour un super_admin", async () => {
    h.selectQueue.push([{ key: "backup_s3", value: { s3BackupBucket: "loriax-backups" } }]);

    const res = await configPut(requeteConfigPut());

    expect(res.status).toBe(200);
    expect(h.insertCalls.count).toBeGreaterThan(0);
    expect(h.reloadBackupScheduler).toHaveBeenCalled();
  });

  it("teste bien la connexion S3 pour un super_admin", async () => {
    h.testBackupS3Connection.mockResolvedValue({ ok: true, bucket: "loriax-backups" });

    const res = await configTestPost();

    expect(res.status).toBe(200);
    expect(h.testBackupS3Connection).toHaveBeenCalledTimes(1);
  });
});
