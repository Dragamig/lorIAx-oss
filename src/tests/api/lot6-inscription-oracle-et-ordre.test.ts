/**
 * Lot 6, incohérence relevée par la revue adversariale : le quota avait été
 * posé sur les DEUX routes d'inscription, l'uniformisation de réponse sur une
 * seule. `/api/auth/register` répondait encore 409 « Un compte avec cet email
 * existe deja », c'est-à-dire l'oracle d'énumération de comptes que
 * `/api/auth/register-org` venait de fermer, sur une route non authentifiée
 * elle aussi.
 *
 * Deux propriétés sont vérifiées ici :
 *  1. la réponse est UNIFORME, au bit près, que l'adresse soit connue ou non,
 *     et le titulaire d'un compte existant est prévenu par courriel ;
 *  2. l'ORDRE des contrôles : les refus qui ne dépendent pas de l'adresse
 *     (organisation d'accueil absente, quota d'utilisateurs) sont prononcés
 *     AVANT la lecture de la table des comptes, faute de quoi l'oracle se
 *     rouvrait par la bande sur une instance vierge ou saturée.
 *
 * La limitation de débit n'est PAS doublée : le vrai module est exercé, avec
 * son adossement mémoire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  /** Files de résultats consommées par les `select().limit()` successifs. */
  queue: [] as unknown[][],
  /** Nombre de lectures réellement effectuées. */
  selects: 0,
  /** Nombre d'insertions réellement effectuées. */
  inserts: 0,
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => {
      dbState.selects += 1;
      return Promise.resolve(dbState.queue.shift() ?? []);
    }),
    insert: vi.fn(() => {
      dbState.inserts += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        values: vi.fn(() => chain),
        returning: vi.fn(async () => [{ id: "user-1", name: "Test" }]),
        onConflictDoNothing: vi.fn(async () => undefined),
        // `await db.insert(...).values(...)` : la chaîne est thenable.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (ok: any, ko: any) => Promise.resolve(undefined).then(ok, ko),
      };
      return chain;
    }),
  };
  return { db: self };
});

const initRepository = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/git/repository", () => ({ initRepository }));

const ensurePersonalCalendar = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/calendar/auto-provision", () => ({ ensurePersonalCalendar }));

const getDefaultOrgId = vi.hoisted(() => vi.fn(async () => "org-1"));
vi.mock("@/lib/org/get-org-id", () => ({ getDefaultOrgId }));

const checkUsersLimit = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ exceeded: false, current: 1, max: 10 }))
);

const sendEmail = vi.hoisted(() => vi.fn(async (_options: { to: string }) => {}));
vi.mock("@/lib/email/send", () => ({ sendEmail }));

vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hash") } }));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/auth/register/route";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import type { UsageStatus } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: (...a: unknown[]) => checkUsersLimit(...a) as Promise<UsageStatus>, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async () => null } });
});


let seq = 0;
const freshEmail = () => `lot6-${Date.now()}-${seq++}@example.test`;

function inscription(opts: { ip?: string; email?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Utilisateur",
      email: opts.email ?? freshEmail(),
      password: "motdepasse123",
    }),
  });
}

/** Réponse complète (statut + corps brut) d'une tentative d'inscription. */
async function reponse(opts: { ip?: string; email?: string } = {}) {
  const res = await POST(inscription(opts));
  return { status: res.status, corps: await res.text() };
}

/** Aucun compte ne porte cette adresse. */
const queueAdresseLibre = () => dbState.queue.push([]);
/** Un compte porte déjà cette adresse. */
const queueAdresseConnue = () => dbState.queue.push([{ id: "user-existant" }]);

beforeEach(() => {
  dbState.queue = [];
  dbState.selects = 0;
  dbState.inserts = 0;
  initRepository.mockClear();
  ensurePersonalCalendar.mockClear();
  sendEmail.mockClear();
  getDefaultOrgId.mockClear();
  getDefaultOrgId.mockResolvedValue("org-1");
  checkUsersLimit.mockClear();
  checkUsersLimit.mockResolvedValue({ exceeded: false, current: 1, max: 10 });
  delete process.env.REDIS_URL;
});

describe("/api/auth/register — la réponse ne dit plus si une adresse est connue", () => {
  it("rend exactement la même chose, au bit près, pour une adresse connue et une inconnue", async () => {
    queueAdresseLibre();
    const inconnue = await reponse({ ip: "198.51.100.30", email: freshEmail() });

    queueAdresseConnue();
    const connue = await reponse({ ip: "198.51.100.31", email: freshEmail() });

    expect(connue.status).toBe(inconnue.status);
    expect(connue.corps).toBe(inconnue.corps);
    // L'ancien 409 nommait le constat : « Un compte avec cet email existe deja ».
    expect(connue.status).not.toBe(409);
    expect(connue.corps).not.toMatch(/existe/i);
  });

  it("ne rend plus d'identifiant d'utilisateur, champ dérivé de la branche", async () => {
    queueAdresseLibre();
    const { corps } = await reponse({ ip: "198.51.100.32" });

    expect(JSON.parse(corps)).toEqual({ message: expect.any(String) });
    expect(JSON.parse(corps)).not.toHaveProperty("userId");
  });

  it("ne crée aucun compte et prévient le titulaire quand l'adresse est connue", async () => {
    const email = freshEmail();
    queueAdresseConnue();

    const res = await POST(inscription({ ip: "198.51.100.33", email }));

    expect(res.status).toBe(200);
    expect(dbState.inserts).toBe(0);
    expect(initRepository).not.toHaveBeenCalled();
    expect(ensurePersonalCalendar).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: email });
  });

  it("garde la réponse uniforme même si la notification par courriel échoue", async () => {
    sendEmail.mockRejectedValueOnce(new Error("SMTP indisponible") as never);
    queueAdresseConnue();
    const enEchec = await reponse({ ip: "198.51.100.34", email: freshEmail() });

    queueAdresseLibre();
    const temoin = await reponse({ ip: "198.51.100.35", email: freshEmail() });

    expect(enEchec.status).toBe(temoin.status);
    expect(enEchec.corps).toBe(temoin.corps);
  });

  it("crée bien le compte, son espace et son calendrier quand l'adresse est libre", async () => {
    queueAdresseLibre();

    const res = await POST(inscription({ ip: "198.51.100.36" }));

    expect(res.status).toBe(200);
    // Compte, rattachement à l'organisation d'accueil, espace personnel.
    expect(dbState.inserts).toBe(3);
    expect(initRepository).toHaveBeenCalledTimes(1);
    expect(ensurePersonalCalendar).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("/api/auth/register — ordre des contrôles", () => {
  it("refuse l'absence d'organisation d'accueil SANS lire la table des comptes", async () => {
    getDefaultOrgId.mockRejectedValueOnce(new Error("aucune organisation") as never);
    queueAdresseConnue();

    const res = await POST(inscription({ ip: "198.51.100.37" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needsOrg: true });
    // La propriété qui compte : aucune lecture de comptes, donc ce refus est
    // rigoureusement le même pour une adresse connue et pour une inconnue.
    expect(dbState.selects).toBe(0);
    expect(dbState.queue).toHaveLength(1);
  });

  it("refuse le dépassement de quota d'utilisateurs SANS lire la table des comptes", async () => {
    checkUsersLimit.mockResolvedValueOnce({ exceeded: true, current: 10, max: 10 });
    queueAdresseConnue();

    const res = await POST(inscription({ ip: "198.51.100.38" }));

    expect(res.status).toBe(403);
    expect(dbState.selects).toBe(0);
    expect(dbState.queue).toHaveLength(1);
  });
});
