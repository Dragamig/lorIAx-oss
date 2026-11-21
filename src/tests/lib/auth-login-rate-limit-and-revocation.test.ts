/**
 * AZ-04 — limitation de débit et verrouillage progressif du fournisseur
 * d'identifiants, seul point d'entrée d'authentification qui n'en avait aucun.
 * AZ-05 / AZ-38 — révocation de session réellement appliquée au
 * rafraîchissement du jeton, et relecture du rôle global et des capacités.
 *
 * La limitation de débit n'est PAS doublée ici : le test exerce le vrai
 * `checkRateLimitAsync` avec son adossement mémoire, ce qui est aussi le
 * comportement de production sans Redis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({ queue: [] as unknown[][], selects: 0 }));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      dbState.selects += 1;
      return self;
    }),
    from: vi.fn(() => self),
    innerJoin: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(dbState.queue.shift() ?? [])),
  };
  return { db: self };
});

const bcryptCompare = vi.hoisted(() => vi.fn(async () => false));
vi.mock("bcryptjs", () => ({
  default: { compare: bcryptCompare, hash: vi.fn(async () => "hash") },
}));

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/modules/registry.generated", () => ({
  INCLUDED_MODULE_IDS: [] as string[],
}));

// NextAuth n'est pas importable hors runtime Next (il charge `next/server`).
// Seule l'usine est doublée : les fonctions testées plus bas, elles, sont bien
// celles de production.
vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  })),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config: unknown) => config),
}));

import { authorizeCredentials, jwtCallback } from "@/lib/auth";

// ─── Utilitaires ────────────────────────────────────────────────────────────

let seq = 0;
/** Adresse unique par test : le magasin de quotas est partagé par le fichier. */
const freshEmail = () => `az04-${Date.now()}-${seq++}@example.test`;
const freshIp = () => `203.0.113.${(seq++ % 200) + 1}-${Date.now()}`;

const withIp = (ip: string) =>
  new Request("http://localhost/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": ip },
  });
const withoutIp = () =>
  new Request("http://localhost/api/auth/callback/credentials");

const existingUser = (email: string) => [
  {
    id: "user-1",
    email,
    name: "Utilisateur",
    passwordHash: "$2a$12$hash",
    avatarUrl: null,
  },
];

/** Une tentative avec un mot de passe faux. */
const attempt = (email: string, request?: Request, rows = existingUser(email)) => {
  dbState.queue.push(rows);
  return authorizeCredentials({ email, password: "mauvais" }, request);
};

beforeEach(() => {
  dbState.queue = [];
  dbState.selects = 0;
  bcryptCompare.mockClear();
  bcryptCompare.mockResolvedValue(false as never);
  process.env.AUTH_SESSION_CACHE_TTL_MS = "0";
});

// ─── AZ-04 ──────────────────────────────────────────────────────────────────

describe("AZ-04 — quota sur le fournisseur d'identifiants", () => {
  it("applique un quota par adresse électronique et refuse au-delà", async () => {
    const email = freshEmail();
    const ip = freshIp();

    for (let i = 0; i < 5; i++) {
      await expect(attempt(email, withIp(ip))).resolves.toBeNull();
    }
    expect(bcryptCompare).toHaveBeenCalledTimes(5);

    // 6e tentative dans la minute : refusée par le palier le plus court.
    dbState.selects = 0;
    await expect(
      authorizeCredentials({ email, password: "mauvais" }, withIp(ip))
    ).resolves.toBeNull();

    // La propriété qui ferme le déni de service processeur : aucun bcrypt,
    // et même aucune lecture en base, une fois le quota dépassé.
    expect(bcryptCompare).toHaveBeenCalledTimes(5);
    expect(dbState.selects).toBe(0);
  });

  it("compte séparément deux adresses électroniques depuis la même IP", async () => {
    const ip = freshIp();
    const bloquee = freshEmail();
    const autre = freshEmail();

    for (let i = 0; i < 6; i++) await attempt(bloquee, withIp(ip));
    expect(bcryptCompare).toHaveBeenCalledTimes(5);

    // L'autre compte, depuis la même IP, garde son propre quota.
    await expect(attempt(autre, withIp(ip))).resolves.toBeNull();
    expect(bcryptCompare).toHaveBeenCalledTimes(6);
  });

  it("applique aussi un quota par adresse IP, même avec des courriels neufs", async () => {
    const ip = freshIp();

    // Palier IP le plus court : 20 tentatives par minute, toutes sur des
    // adresses différentes pour que seul le seau IP puisse déclencher.
    for (let i = 0; i < 20; i++) await attempt(freshEmail(), withIp(ip));
    expect(bcryptCompare).toHaveBeenCalledTimes(20);

    dbState.selects = 0;
    await expect(
      authorizeCredentials({ email: freshEmail(), password: "mauvais" }, withIp(ip))
    ).resolves.toBeNull();
    expect(bcryptCompare).toHaveBeenCalledTimes(20);
    expect(dbState.selects).toBe(0);
  });

  it("ne verrouille pas globalement quand l'en-tête d'IP manque", async () => {
    // getClientIp rend la constante "unknown" sans x-forwarded-for (AZ-25).
    // Compter dessus ferait d'un attaquant unique un déni de service global.
    for (let i = 0; i < 25; i++) await attempt(freshEmail(), withoutIp());
    const avant = bcryptCompare.mock.calls.length;

    await expect(attempt(freshEmail(), withoutIp())).resolves.toBeNull();
    expect(bcryptCompare.mock.calls.length).toBe(avant + 1);
  });

  it("ne distingue pas un compte existant d'un compte inexistant une fois le quota dépassé", async () => {
    const existant = freshEmail();
    const inexistant = freshEmail();
    // Même adresse cliente d'un bout à l'autre : le seau serré est indexé sur
    // le COUPLE compte + adresse, changer d'adresse à chaque coup ne
    // l'épuiserait pas.
    const ip = freshIp();

    for (let i = 0; i < 6; i++) await attempt(existant, withIp(ip));
    for (let i = 0; i < 6; i++) await attempt(inexistant, withIp(ip), []);

    bcryptCompare.mockClear();
    dbState.selects = 0;

    const refusExistant = await authorizeCredentials(
      { email: existant, password: "mauvais" },
      withIp(ip)
    );
    const selectsApresExistant = dbState.selects;

    const refusInexistant = await authorizeCredentials(
      { email: inexistant, password: "mauvais" },
      withIp(ip)
    );

    // Même valeur de retour, donc même erreur NextAuth côté client.
    expect(refusExistant).toBeNull();
    expect(refusInexistant).toBeNull();
    // Et aucun canal auxiliaire : ni bcrypt ni requête en base d'un côté
    // comme de l'autre, donc pas d'oracle temporel non plus.
    expect(bcryptCompare).not.toHaveBeenCalled();
    expect(selectsApresExistant).toBe(0);
    expect(dbState.selects).toBe(0);
  });

  it("ne laisse PAS le compte verrouillé après une authentification réussie", async () => {
    // Le défaut corrigé : le compteur ne comptait pas les échecs mais les
    // tentatives, et rien ne le remettait à zéro. Un utilisateur qui cherche
    // son mot de passe puis le retrouve restait verrouillé.
    const email = freshEmail();
    const ip = freshIp();

    for (let i = 0; i < 4; i++) await attempt(email, withIp(ip));

    bcryptCompare.mockResolvedValue(true as never);
    dbState.queue.push(existingUser(email));
    await expect(
      authorizeCredentials({ email, password: "bon" }, withIp(ip))
    ).resolves.toMatchObject({ id: "user-1", email });

    // Les seaux du compte sont neufs : cinq échecs de plus sont encore
    // calculés, alors qu'ils auraient été refusés sans remise à zéro.
    bcryptCompare.mockResolvedValue(false as never);
    bcryptCompare.mockClear();
    for (let i = 0; i < 5; i++) await attempt(email, withIp(ip));
    expect(bcryptCompare).toHaveBeenCalledTimes(5);
  });

  it("ne permet pas à un tiers de verrouiller un compte depuis une autre adresse", async () => {
    // Le seau serré est indexé sur le COUPLE compte + adresse : l'attaquant
    // épuise le sien, la victime garde le sien.
    const victime = freshEmail();
    const ipAttaquant = freshIp();
    const ipVictime = freshIp();

    for (let i = 0; i < 8; i++) await attempt(victime, withIp(ipAttaquant));

    bcryptCompare.mockResolvedValue(true as never);
    bcryptCompare.mockClear();
    dbState.queue.push(existingUser(victime));
    await expect(
      authorizeCredentials({ email: victime, password: "bon" }, withIp(ipVictime))
    ).resolves.toMatchObject({ id: "user-1", email: victime });
    expect(bcryptCompare).toHaveBeenCalledTimes(1);
  });

  it("laisse l'attaquant bloqué, sans lecture en base ni calcul de mot de passe", async () => {
    const victime = freshEmail();
    const ipAttaquant = freshIp();

    for (let i = 0; i < 5; i++) await attempt(victime, withIp(ipAttaquant));

    bcryptCompare.mockClear();
    dbState.selects = 0;
    await expect(
      authorizeCredentials({ email: victime, password: "mauvais" }, withIp(ipAttaquant))
    ).resolves.toBeNull();
    expect(bcryptCompare).not.toHaveBeenCalled();
    expect(dbState.selects).toBe(0);
  });

  it("rattrape le bourrage distribué par le palier de secours sur le compte seul", async () => {
    // Cent échecs depuis cent adresses différentes : aucun seau par couple
    // n'est épuisé, c'est le palier large par compte qui doit fermer la porte.
    const email = freshEmail();
    for (let i = 0; i < 100; i++) await attempt(email, withIp(freshIp()));

    bcryptCompare.mockClear();
    dbState.selects = 0;
    await expect(
      authorizeCredentials({ email, password: "mauvais" }, withIp(freshIp()))
    ).resolves.toBeNull();
    expect(bcryptCompare).not.toHaveBeenCalled();
    expect(dbState.selects).toBe(0);
  });

  it("laisse passer une authentification valide sous le quota", async () => {
    const email = freshEmail();
    bcryptCompare.mockResolvedValue(true as never);
    dbState.queue.push(existingUser(email));
    await expect(
      authorizeCredentials({ email, password: "bon" }, withIp(freshIp()))
    ).resolves.toMatchObject({ id: "user-1", email });
  });
});

// ─── AZ-05 / AZ-38 ──────────────────────────────────────────────────────────

const dbUserState = (over: Record<string, unknown> = {}) => [
  {
    globalRole: "editor",
    capabilities: [],
    avatarUrl: null,
    mustResetPassword: false,
    tokenInvalidatedAt: null,
    ...over,
  },
];

describe("AZ-05 — révocation de session appliquée au rafraîchissement", () => {
  it("rejette un jeton émis AVANT la réinitialisation du mot de passe", async () => {
    const invalidatedAt = new Date(2_000_000 * 1000);
    dbState.queue.push(dbUserState({ tokenInvalidatedAt: invalidatedAt }));

    const result = await jwtCallback({
      token: { id: "user-1", iat: 1_999_000 },
    });

    expect(result).toBeNull();
  });

  it("laisse valide un jeton émis APRÈS la réinitialisation", async () => {
    const invalidatedAt = new Date(2_000_000 * 1000);
    dbState.queue.push(dbUserState({ tokenInvalidatedAt: invalidatedAt }));

    const result = await jwtCallback({
      token: { id: "user-1", iat: 2_001_000 },
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ id: "user-1" });
  });

  it("relit l'horodatage en base : il n'a pas besoin d'être déjà dans le jeton", async () => {
    dbState.queue.push(dbUserState({ tokenInvalidatedAt: new Date(5_000_000 * 1000) }));
    const result = await jwtCallback({ token: { id: "user-1", iat: 4_000_000 } });
    expect(result).toBeNull();
  });

  it("ne détruit PAS un jeton émis juste après l'invalidation, dans la même seconde", async () => {
    // Le défaut corrigé : l'horodatage d'invalidation était arrondi au
    // SUPÉRIEUR, si bien qu'un jeton émis dans la même seconde qu'une
    // réinitialisation passait pour antérieur et était détruit au premier
    // rafraîchissement. La comparaison se fait maintenant à la milliseconde.
    dbState.queue.push(dbUserState({ tokenInvalidatedAt: new Date(2_000_000_500) }));

    const result = await jwtCallback({
      token: { id: "user-1", iat: 2_000_000, iatMs: 2_000_000_900 },
    });

    expect(result).not.toBeNull();
  });

  it("détruit un jeton émis juste AVANT l'invalidation, dans la même seconde", async () => {
    dbState.queue.push(dbUserState({ tokenInvalidatedAt: new Date(2_000_000_500) }));

    const result = await jwtCallback({
      token: { id: "user-1", iat: 2_000_000, iatMs: 2_000_000_100 },
    });

    expect(result).toBeNull();
  });

  it("ferme la session d'un utilisateur supprimé", async () => {
    dbState.queue.push([]);
    await expect(jwtCallback({ token: { id: "user-1", iat: 10 } })).resolves.toBeNull();
  });
});

describe("AZ-38 — rôle global et capacités relus à chaque rafraîchissement", () => {
  it("applique une rétrogradation sans attendre l'expiration du jeton", async () => {
    dbState.queue.push(dbUserState({ globalRole: "viewer", capabilities: [] }));

    const result = await jwtCallback({
      token: {
        id: "user-1",
        iat: 1_000,
        globalRole: "super_admin",
        capabilities: ["manage_users"],
      },
    });

    expect(result).toMatchObject({ globalRole: "viewer", capabilities: [] });
  });

  it("applique une promotion de la même façon", async () => {
    dbState.queue.push(dbUserState({ globalRole: "admin", capabilities: ["manage_users"] }));
    const result = await jwtCallback({
      token: { id: "user-1", iat: 1_000, globalRole: "editor", capabilities: [] },
    });
    expect(result).toMatchObject({
      globalRole: "admin",
      capabilities: ["manage_users"],
    });
  });
});
