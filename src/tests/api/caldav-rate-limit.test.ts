/**
 * H11 : la route CalDAV doit refuser un client qui insiste avec de mauvais
 * identifiants. Le seuil est celui de AUTH_FAILURE_TIERS (premier palier), pas
 * un seuil propre à la route. Le refus reste un 401, volontairement
 * indistinguable d'un mot de passe faux (pas de signal de verrouillage donné à
 * un attaquant).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

const bcryptCompare = vi.hoisted(() => vi.fn(async () => false));
vi.mock("bcryptjs", () => ({ default: { compare: bcryptCompare } }));
vi.mock("@/lib/auth/api-key", () => ({
  resolveApiKey: vi.fn(),
  hasScope: (scopes: string[], required: string) => scopes.includes(required),
}));
vi.mock("@/lib/calendar/permissions", () => ({
  checkCalendarAccess: vi.fn(async () => false),
}));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({ entitlements: { hasFeature: vi.fn(async () => false) } }),
}));
vi.mock("@/lib/calendar/ical", () => ({ generateICalendar: vi.fn(() => "") }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => null) }));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from "@/app/api/caldav/[...path]/route";
import { AUTH_FAILURE_TIERS } from "@/lib/rate-limit";

const user = (email: string) => [
  {
    id: "user-1",
    email,
    name: "U",
    passwordHash: "$2a$12$hash",
    globalRole: "user",
    capabilities: [],
    avatarUrl: null,
    mustResetPassword: false,
  },
];

const call = (email: string, password: string, ip: string) =>
  GET(
    new NextRequest("http://localhost/api/caldav/principals/", {
      headers: {
        authorization: "Basic " + Buffer.from(`${email}:${password}`).toString("base64"),
        "x-forwarded-for": ip,
      },
    }),
    { params: Promise.resolve({ path: ["principals"] }) }
  );

beforeEach(() => {
  process.env.CALDAV_ENABLED = "true";
  delete process.env.REDIS_URL;
  dbState.queue = [];
  bcryptCompare.mockClear();
  bcryptCompare.mockResolvedValue(false as never);
});

describe("CalDAV : limite de débit des échecs d'authentification", () => {
  it("caldav_returns_429_after_threshold_failed_auth (refus sans calcul bcrypt au-delà du seuil)", async () => {
    const email = `h11-${Date.now()}@example.test`;
    const ip = "203.0.113.77";
    const threshold = AUTH_FAILURE_TIERS[0].maxRequests;

    for (let i = 0; i < threshold; i++) {
      dbState.queue.push(user(email));
      expect((await call(email, "faux", ip)).status).toBe(401);
    }
    expect(bcryptCompare).toHaveBeenCalledTimes(threshold);

    // Au-delà du seuil, même avec le BON mot de passe : refus en amont.
    bcryptCompare.mockResolvedValue(true as never);
    dbState.queue.push(user(email));
    const res = await call(email, "bon", ip);
    expect([401, 429]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(bcryptCompare).toHaveBeenCalledTimes(threshold);
  });
});
