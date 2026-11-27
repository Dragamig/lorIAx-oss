/**
 * AZ-26 — la variante synchrone de limitation de débit ignore Redis par
 * construction. Sur plusieurs répliques, les quotas d'authentification et d'IA
 * étaient donc multipliés par le nombre d'instances, et tout redémarrage
 * remettait les compteurs mémoire à zéro.
 *
 * Ce fichier prouve que les routes basculées consomment bien le compteur
 * PARTAGÉ et non le compteur mémoire du processus. Le client Redis est doublé,
 * mais tout le reste est le vrai code : le module de limitation de débit et le
 * handler de la route d'inscription.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Faux client Redis ──────────────────────────────────────────────────────

const redisState = vi.hoisted(() => ({
  counters: new Map<string, number>(),
  ttls: new Map<string, number>(),
  /** Toutes les clés incrémentées, dans l'ordre. */
  incrs: [] as string[],
  connects: 0,
  failNextConnects: 0,
}));

vi.mock("ioredis", () => {
  class FakeRedis {
    constructor(_url: string, _opts?: unknown) {}
    async connect() {
      redisState.connects += 1;
      if (redisState.failNextConnects > 0) {
        redisState.failNextConnects -= 1;
        throw new Error("ECONNREFUSED");
      }
    }
    on() {}
    multi() {
      let key = "";
      const chain = {
        incr: (k: string) => {
          key = k;
          return chain;
        },
        pttl: (k: string) => {
          key = k;
          return chain;
        },
        exec: async () => {
          redisState.incrs.push(key);
          const count = (redisState.counters.get(key) ?? 0) + 1;
          redisState.counters.set(key, count);
          return [
            [null, count],
            [null, redisState.ttls.get(key) ?? -1],
          ];
        },
      };
      return chain;
    }
    async pexpire(key: string, ms: number) {
      redisState.ttls.set(key, ms);
    }
  }
  return { default: FakeRedis };
});

// ─── Doublures des dépendances de la route d'inscription ────────────────────

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return { db: self };
});
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hash") } }));
vi.mock("@/lib/auth/registration-policy", () => ({ getRegistrationRefusal: async () => null }));
vi.mock("@/lib/git/repository", () => ({ initRepository: vi.fn(async () => {}) }));
vi.mock("@/lib/calendar/auto-provision", () => ({
  ensurePersonalCalendar: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/registration-setting", () => ({ isRegistrationOpen: vi.fn(async () => true) }));
vi.mock("@/lib/auth/email-verification", () => ({
  sendVerificationEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock("@/lib/org/get-org-id", () => ({
  getDefaultOrgId: vi.fn(async () => {
    throw new Error("pas d'organisation");
  }),
}));

import {
  checkRateLimit,
  checkRateLimitAsync,
  __resetRateLimitBackendForTests,
} from "@/lib/rate-limit";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: (async () => ({ exceeded: false, current: 0, max: null, percentage: 0 })), checkSpacesLimit: async () => ({ exceeded: false, current: 0, max: null, percentage: 0 }), getOrgStorageLimitBytes: async () => null } });
});


let seq = 0;
const freshKey = () => `az26-${Date.now()}-${seq++}`;

const registerRequest = (ip: string) =>
  new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Test",
      email: `az26-${seq++}@example.test`,
      password: "motdepasse123",
    }),
  });

beforeEach(() => {
  redisState.counters.clear();
  redisState.ttls.clear();
  redisState.incrs = [];
  redisState.connects = 0;
  redisState.failNextConnects = 0;
  process.env.REDIS_URL = "redis://fake:6379";
  __resetRateLimitBackendForTests();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.REDIS_URL;
  __resetRateLimitBackendForTests();
});

describe("AZ-26 — le compteur partagé est réellement utilisé", () => {
  it("écrit dans Redis et NON dans le compteur mémoire du processus", async () => {
    const key = freshKey();
    const config = { maxRequests: 3, windowMs: 60_000 };

    for (let i = 0; i < 3; i++) {
      await expect(checkRateLimitAsync(key, config)).resolves.toMatchObject({
        success: true,
      });
    }
    await expect(checkRateLimitAsync(key, config)).resolves.toMatchObject({
      success: false,
    });

    // Le compteur vit bien dans Redis.
    expect(redisState.incrs.filter((k) => k === `rl:${key}`)).toHaveLength(4);
    expect(redisState.counters.get(`rl:${key}`)).toBe(4);

    // Et nulle part ailleurs : le seau mémoire de la même clé est intact.
    expect(checkRateLimit(key, config)).toMatchObject({
      success: true,
      remaining: 2,
    });
  });

  it("fait passer le quota de la route d'inscription par le compteur partagé", async () => {
    const ip = "203.0.113.26";

    // 10 tentatives autorisées par le préréglage d'authentification.
    for (let i = 0; i < 10; i++) {
      const res = await registerPost(registerRequest(ip));
      expect(res.status).not.toBe(429);
    }

    const refused = await registerPost(registerRequest(ip));
    expect(refused.status).toBe(429);

    // La propriété qui ferme AZ-26 : c'est bien Redis qui a compté, donc le
    // quota vaut 10 pour le déploiement entier et non 10 par réplique.
    expect(redisState.incrs).toContain(`rl:register:${ip}`);
    expect(redisState.counters.get(`rl:register:${ip}`)).toBe(11);
  });

  it("applique aussi un palier par adresse électronique, actif sans adresse IP", async () => {
    const email = `az26-email-${Date.now()}@example.test`;
    const body = JSON.stringify({ name: "Test", email, password: "motdepasse123" });
    const noIpRequest = () =>
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

    for (let i = 0; i < 10; i++) {
      expect((await registerPost(noIpRequest())).status).not.toBe(429);
    }
    expect((await registerPost(noIpRequest())).status).toBe(429);

    // Aucun seau indexé sur la constante « adresse inconnue » n'a été créé.
    expect(redisState.incrs.some((k) => k.includes("unknown"))).toBe(false);
    expect(redisState.counters.get(`rl:register:email:${email}`)).toBe(11);
  });
});

describe("AZ-26 — le client Redis retente sa connexion après une coupure", () => {
  it("ne reste pas verrouillé sur le repli mémoire pour toute la vie du processus", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));

    redisState.failNextConnects = 1;
    const key = freshKey();
    const config = { maxRequests: 5, windowMs: 60_000 };

    // Première tentative : Redis refuse, repli mémoire silencieux.
    await expect(checkRateLimitAsync(key, config)).resolves.toMatchObject({
      success: true,
    });
    expect(redisState.connects).toBe(1);
    expect(redisState.incrs).toHaveLength(0);

    // Pendant la fenêtre de refroidissement, on ne martèle pas la connexion.
    vi.setSystemTime(new Date("2026-08-20T10:00:10Z"));
    await checkRateLimitAsync(key, config);
    expect(redisState.connects).toBe(1);

    // Passé le refroidissement, la connexion est retentée et réussit.
    vi.setSystemTime(new Date("2026-08-20T10:01:00Z"));
    await checkRateLimitAsync(key, config);
    expect(redisState.connects).toBe(2);
    expect(redisState.incrs).toContain(`rl:${key}`);
  });
});
