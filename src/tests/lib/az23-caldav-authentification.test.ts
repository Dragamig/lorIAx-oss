/**
 * AZ-23 — l'authentification CalDAV acceptait le mot de passe COMPLET du compte
 * en authentification basique, sans aucune limitation de débit, sans respecter
 * la réinitialisation forcée de mot de passe, et acceptait toute clé d'API
 * valide quels que soient ses scopes.
 *
 * Un attaquant pouvait donc bruteforcer les mots de passe par un chemin qui
 * échappe entièrement à la surveillance du formulaire de connexion, et une clé
 * créée avec le seul scope de recherche donnait un accès complet au calendrier.
 *
 * La limitation de débit n'est PAS doublée : le test exerce le vrai module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({ queue: [] as unknown[][] }));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(dbState.queue.shift() ?? [])),
  };
  return { db: self };
});

const bcryptCompare = vi.hoisted(() => vi.fn(async () => true));
vi.mock("bcryptjs", () => ({ default: { compare: bcryptCompare } }));

const resolveApiKey = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/api-key", () => ({
  resolveApiKey,
  // `hasScope` reste la vraie logique : c'est elle qu'on veut exercer.
  hasScope: (scopes: string[], required: string) => scopes.includes(required),
}));

vi.mock("@/lib/calendar/permissions", () => ({
  checkCalendarAccess: vi.fn(async () => false),
}));
const checkFeature = vi.hoisted(() => vi.fn(async () => false));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({ entitlements: { hasFeature: checkFeature } }),
}));
vi.mock("@/lib/calendar/ical", () => ({ generateICalendar: vi.fn(() => "") }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => null) }));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { authenticateCalDAV } from "@/lib/calendar/caldav-server";

let seq = 0;
const freshEmail = () => `az23-${Date.now()}-${seq++}@example.test`;
const freshIp = () => `198.51.100.${(seq++ % 200) + 1}`;

const dbUser = (email: string, extra: Record<string, unknown> = {}) => [
  {
    id: "user-1",
    email,
    name: "Utilisateur",
    passwordHash: "$2a$12$hash",
    globalRole: "user",
    capabilities: [],
    avatarUrl: null,
    mustResetPassword: false,
    ...extra,
  },
];

const basicRequest = (email: string, password: string, ip: string) =>
  new Request("http://localhost/api/caldav/", {
    headers: {
      authorization: "Basic " + Buffer.from(`${email}:${password}`).toString("base64"),
      "x-forwarded-for": ip,
    },
  });

const bearerRequest = (ip: string) =>
  new Request("http://localhost/api/caldav/", {
    headers: { authorization: "Bearer lrx_cle", "x-forwarded-for": ip },
  });

beforeEach(() => {
  dbState.queue = [];
  bcryptCompare.mockClear();
  bcryptCompare.mockResolvedValue(true as never);
  resolveApiKey.mockReset();
  delete process.env.REDIS_URL;
});

describe("AZ-23 — l'authentification basique CalDAV est limitée en débit", () => {
  it("refuse au-delà du palier le plus court, sans même calculer le condensat", async () => {
    const email = freshEmail();
    const ip = freshIp();
    bcryptCompare.mockResolvedValue(false as never);

    for (let i = 0; i < 5; i++) {
      dbState.queue.push(dbUser(email));
      await expect(authenticateCalDAV(basicRequest(email, "faux", ip))).resolves.toBeNull();
    }
    expect(bcryptCompare).toHaveBeenCalledTimes(5);

    // 6e tentative dans la minute : refusée en amont. Le compte est bien
    // disponible en base, pour que le refus ne puisse venir que du quota.
    dbState.queue.push(dbUser(email));
    await expect(
      authenticateCalDAV(basicRequest(email, "faux", ip))
    ).resolves.toBeNull();

    // La propriété qui ferme le bruteforce et le déni de service processeur :
    // aucun calcul bcrypt supplémentaire une fois le quota dépassé.
    expect(bcryptCompare).toHaveBeenCalledTimes(5);
  });

  it("ne fait PAS payer le succès : un cycle de synchronisation complet passe", async () => {
    // Forme réelle du protocole : toutes les méthodes sauf OPTIONS
    // s'authentifient, et un cycle enchaîne PROPFIND principal, PROPFIND
    // maison, PROPFIND calendrier, REPORT de synchronisation puis un GET par
    // événement modifié. Cinq requêtes est un plancher. Le frein ne comptant
    // que les échecs, aucune n'est refusée.
    const email = freshEmail();
    const ip = freshIp();

    for (let i = 0; i < 8; i++) {
      dbState.queue.push(dbUser(email));
      await expect(
        authenticateCalDAV(basicRequest(email, "bon", ip))
      ).resolves.toMatchObject({ id: "user-1", email });
    }
  });

  it("laisse passer un envoi initial de cent événements, une requête par événement", async () => {
    const email = freshEmail();
    const ip = freshIp();

    for (let i = 0; i < 100; i++) dbState.queue.push(dbUser(email));

    for (let i = 0; i < 100; i++) {
      const user = await authenticateCalDAV(basicRequest(email, "bon", ip));
      expect(user, `requête PUT n° ${i + 1}`).not.toBeNull();
    }
  });

  it("remet le compteur à zéro sur une authentification réussie", async () => {
    const email = freshEmail();
    const ip = freshIp();

    bcryptCompare.mockResolvedValue(false as never);
    for (let i = 0; i < 4; i++) {
      dbState.queue.push(dbUser(email));
      await authenticateCalDAV(basicRequest(email, "faux", ip));
    }

    bcryptCompare.mockResolvedValue(true as never);
    dbState.queue.push(dbUser(email));
    await expect(
      authenticateCalDAV(basicRequest(email, "bon", ip))
    ).resolves.not.toBeNull();

    // Seaux neufs : cinq échecs de plus sont encore calculés.
    bcryptCompare.mockResolvedValue(false as never);
    bcryptCompare.mockClear();
    for (let i = 0; i < 5; i++) {
      dbState.queue.push(dbUser(email));
      await authenticateCalDAV(basicRequest(email, "faux", ip));
    }
    expect(bcryptCompare).toHaveBeenCalledTimes(5);
  });

  it("ne laisse pas un tiers verrouiller un compte depuis une autre adresse", async () => {
    const email = freshEmail();
    const ipAttaquant = freshIp();
    const ipClient = freshIp();

    bcryptCompare.mockResolvedValue(false as never);
    for (let i = 0; i < 8; i++) {
      dbState.queue.push(dbUser(email));
      await authenticateCalDAV(basicRequest(email, "faux", ipAttaquant));
    }

    bcryptCompare.mockResolvedValue(true as never);
    dbState.queue.push(dbUser(email));
    await expect(
      authenticateCalDAV(basicRequest(email, "bon", ipClient))
    ).resolves.toMatchObject({ id: "user-1", email });
  });

  it("garde bloqué l'attaquant qui échoue, sans calcul de condensat", async () => {
    const email = freshEmail();
    const ip = freshIp();
    bcryptCompare.mockResolvedValue(false as never);

    for (let i = 0; i < 5; i++) {
      dbState.queue.push(dbUser(email));
      await authenticateCalDAV(basicRequest(email, "faux", ip));
    }

    bcryptCompare.mockClear();
    dbState.queue.push(dbUser(email));
    await expect(
      authenticateCalDAV(basicRequest(email, "faux", ip))
    ).resolves.toBeNull();
    expect(bcryptCompare).not.toHaveBeenCalled();
  });

  it("bloque une clé d'API refusée à répétition, sans gêner une clé valide", async () => {
    const ip = freshIp();
    resolveApiKey.mockResolvedValue(null as never);

    for (let i = 0; i < 5; i++) {
      await expect(authenticateCalDAV(bearerRequest(ip))).resolves.toBeNull();
    }
    expect(resolveApiKey).toHaveBeenCalledTimes(5);

    // 6e tentative : refusée en amont, la clé n'est même plus résolue.
    resolveApiKey.mockClear();
    await expect(authenticateCalDAV(bearerRequest(ip))).resolves.toBeNull();
    expect(resolveApiKey).not.toHaveBeenCalled();
  });
});

describe("AZ-23 — la réinitialisation forcée de mot de passe est respectée", () => {
  it("refuse un compte dont le mot de passe doit être changé, mot de passe pourtant juste", async () => {
    const email = freshEmail();
    dbState.queue.push(dbUser(email, { mustResetPassword: true }));

    await expect(
      authenticateCalDAV(basicRequest(email, "bon", freshIp()))
    ).resolves.toBeNull();
    // Le mot de passe était bien reconnu : c'est la contrainte qui refuse.
    expect(bcryptCompare).toHaveBeenCalledTimes(1);
  });

  it("laisse passer le même compte une fois la contrainte levée", async () => {
    const email = freshEmail();
    dbState.queue.push(dbUser(email, { mustResetPassword: false }));

    await expect(
      authenticateCalDAV(basicRequest(email, "bon", freshIp()))
    ).resolves.toMatchObject({ id: "user-1", email });
  });

  it("refuse aussi une clé d'API dont le titulaire doit changer de mot de passe", async () => {
    resolveApiKey.mockResolvedValue({
      userId: "user-1",
      scopes: ["calendars:read"],
    } as never);
    dbState.queue.push(dbUser(freshEmail(), { mustResetPassword: true }));

    await expect(authenticateCalDAV(bearerRequest(freshIp()))).resolves.toBeNull();
  });
});

describe("AZ-23 — le scope de calendrier est exigé sur le chemin par clé d'API", () => {
  it("refuse une clé valide qui n'a pas de scope de calendrier", async () => {
    resolveApiKey.mockResolvedValue({
      userId: "user-1",
      scopes: ["search", "documents:read"],
    } as never);
    dbState.queue.push(dbUser(freshEmail()));

    await expect(authenticateCalDAV(bearerRequest(freshIp()))).resolves.toBeNull();
  });

  it("refuse une clé sans aucun scope", async () => {
    resolveApiKey.mockResolvedValue({ userId: "user-1", scopes: [] } as never);
    dbState.queue.push(dbUser(freshEmail()));

    await expect(authenticateCalDAV(bearerRequest(freshIp()))).resolves.toBeNull();
  });

  it("accepte une clé portant le scope de lecture des calendriers", async () => {
    const email = freshEmail();
    resolveApiKey.mockResolvedValue({
      userId: "user-1",
      scopes: ["calendars:read"],
    } as never);
    dbState.queue.push(dbUser(email));

    await expect(authenticateCalDAV(bearerRequest(freshIp()))).resolves.toMatchObject({
      id: "user-1",
      email,
    });
  });

  it("accepte une clé portant le scope d'écriture des calendriers", async () => {
    const email = freshEmail();
    resolveApiKey.mockResolvedValue({
      userId: "user-1",
      scopes: ["calendars:write"],
    } as never);
    dbState.queue.push(dbUser(email));

    await expect(authenticateCalDAV(bearerRequest(freshIp()))).resolves.toMatchObject({
      id: "user-1",
      email,
    });
  });
});

describe("CalDAV n'exige pas la fonctionnalité de plan api_access", () => {
  it("accepte une clé neuve avec le scope calendrier sans consulter la licence", async () => {
    resolveApiKey.mockResolvedValue({
      userId: "user-1",
      scopes: ["calendars:read"],
    } as never);
    dbState.queue.push(dbUser(freshEmail()));

    await expect(authenticateCalDAV(bearerRequest(freshIp()))).resolves.toMatchObject({
      id: "user-1",
    });
    expect(checkFeature).not.toHaveBeenCalled();
  });
});
