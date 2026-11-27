/** AZ-27 : refus de connexion tant que l'email n'est pas vérifié. */
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

const bcryptCompare = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => false));
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

import { authorizeCredentials } from "@/lib/auth";
import { EmailNotVerifiedError } from "@/lib/auth/errors";

// ─── Utilitaires ────────────────────────────────────────────────────────────

let seq = 0;
/** Adresse unique par test : le magasin de quotas est partagé par le fichier. */
const freshEmail = () => `az04-${Date.now()}-${seq++}@example.test`;
const freshIp = () => `203.0.113.${(seq++ % 200) + 1}-${Date.now()}`;

const withIp = (ip: string) =>
  new Request("http://localhost/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": ip },
  });

const existingUser = (email: string) => [
  {
    id: "user-1",
    email,
    name: "Utilisateur",
    passwordHash: "$2a$12$hash",
    avatarUrl: null,
  },
];


beforeEach(() => {
  dbState.queue = [];
  dbState.selects = 0;
  bcryptCompare.mockClear();
  bcryptCompare.mockResolvedValue(false as never);
  process.env.AUTH_SESSION_CACHE_TTL_MS = "0";
});


const ip = () => withIp(freshIp());
const row = (email: string, extra: Record<string, unknown>) => [
  { ...existingUser(email)[0], ...extra },
];
const run = (email: string, password: string, rows: unknown[], req?: Request) => {
  dbState.queue.push(rows);
  return authorizeCredentials({ email, password }, req);
};

beforeEach(() => {
  dbState.queue = [];
  dbState.selects = 0;
  bcryptCompare.mockReset();
  process.env.AUTH_SESSION_CACHE_TTL_MS = "0";
});

describe("AZ-27 : porte de connexion", () => {
  it("mot de passe correct et compte non vérifié : EmailNotVerifiedError", async () => {
    bcryptCompare.mockResolvedValue(true);
    const email = freshEmail();
    const p = run(email, "ok", row(email, { emailVerifiedAt: null }), ip());
    await expect(p).rejects.toBeInstanceOf(EmailNotVerifiedError);
    await expect(
      (async () => {
        try {
          await run(email, "ok", row(email, { emailVerifiedAt: null }), ip());
        } catch (e) {
          return (e as { code?: string }).code;
        }
      })()
    ).resolves.toBe("email_not_verified");
  });

  it("mot de passe faux et compte non vérifié : null, échec comptabilisé", async () => {
    bcryptCompare.mockResolvedValue(false);
    const email = freshEmail();
    const req = ip();
    for (let i = 0; i < 5; i++) {
      await expect(run(email, "x", row(email, { emailVerifiedAt: null }), req)).resolves.toBeNull();
    }
    // 6e : quota dépassé, aucune lecture en base
    dbState.selects = 0;
    await expect(authorizeCredentials({ email, password: "x" }, req)).resolves.toBeNull();
    expect(dbState.selects).toBe(0);
  });

  it("le refus non vérifié ne consomme aucun quota", async () => {
    bcryptCompare.mockResolvedValue(true);
    const email = freshEmail();
    const req = ip();
    for (let i = 0; i < 25; i++) {
      await expect(
        run(email, "ok", row(email, { emailVerifiedAt: null }), req)
      ).rejects.toBeInstanceOf(EmailNotVerifiedError);
    }
    dbState.queue.push(row(email, { emailVerifiedAt: new Date() }));
    await expect(authorizeCredentials({ email, password: "ok" }, req)).resolves.toMatchObject({
      email,
    });
  });

  it("compte vérifié : utilisateur renvoyé", async () => {
    bcryptCompare.mockResolvedValue(true);
    const email = freshEmail();
    await expect(
      run(email, "ok", row(email, { emailVerifiedAt: new Date() }), ip())
    ).resolves.toMatchObject({ email });
  });

  it("emailVerifiedAt absent (undefined) : utilisateur renvoyé", async () => {
    bcryptCompare.mockResolvedValue(true);
    const email = freshEmail();
    await expect(run(email, "ok", existingUser(email), ip())).resolves.toMatchObject({ email });
  });

  it("quota déjà dépassé : null avant tout accès base", async () => {
    bcryptCompare.mockResolvedValue(false);
    const email = freshEmail();
    const req = ip();
    for (let i = 0; i < 6; i++) await run(email, "x", existingUser(email), req);
    dbState.selects = 0;
    await expect(authorizeCredentials({ email, password: "x" }, req)).resolves.toBeNull();
    expect(dbState.selects).toBe(0);
  });

  it("LDAP inchangé : module absent, mot de passe faux : null", async () => {
    bcryptCompare.mockResolvedValue(false);
    const email = freshEmail();
    await expect(
      run(email, "x", row(email, { emailVerifiedAt: null }), ip())
    ).resolves.toBeNull();
  });
});
