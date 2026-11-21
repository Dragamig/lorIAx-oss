/**
 * AZ-05 (second volet) — la réinitialisation de mot de passe par courriel doit
 * poser `tokenInvalidatedAt`, comme le fait déjà `force-reset-password`. Sans
 * lui, la révocation relue par le rappel `jwt` n'a rien à lire et un cookie
 * volé survit 24 h au changement de mot de passe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  rows: [] as unknown[][],
  call: 0,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      dbState.call += 1;
      return self;
    }),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(dbState.rows[dbState.call - 1] ?? [])),
    update: vi.fn(() => self),
    set: vi.fn((values: Record<string, unknown>) => {
      dbState.updates.push(values);
      return self;
    }),
  };
  return { db: self };
});

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "$2a$12$nouveau"), compare: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ clearAuthUserStateCache: vi.fn() }));

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/auth/reset-password/route";

const makeRequest = (body: unknown, ip: string) =>
  new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  dbState.rows = [];
  dbState.call = 0;
  dbState.updates = [];
});

describe("POST /api/auth/reset-password", () => {
  it("révoque les sessions ouvertes en posant tokenInvalidatedAt", async () => {
    dbState.rows = [
      [{ id: "reset-1", userId: "user-1", token: "jeton", usedAt: null }],
    ];

    const before = Date.now();
    const res = await POST(
      makeRequest({ token: "jeton", password: "motdepasse-long" }, `198.51.100.${Date.now() % 200}`)
    );
    expect(res.status).toBe(200);

    const userUpdate = dbState.updates[0];
    expect(userUpdate).toBeDefined();
    expect(userUpdate.passwordHash).toBe("$2a$12$nouveau");
    expect(userUpdate.tokenInvalidatedAt).toBeInstanceOf(Date);
    expect((userUpdate.tokenInvalidatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("password_reset_revokes_lrx_api_keys : les clés lrx_ du compte reçoivent revokedAt", async () => {
    dbState.rows = [
      [{ id: "reset-2", userId: "user-2", token: "jeton2", usedAt: null }],
    ];

    const before = Date.now();
    const res = await POST(
      makeRequest({ token: "jeton2", password: "motdepasse-long" }, `203.0.113.${Date.now() % 200}`)
    );
    expect(res.status).toBe(200);

    const keyUpdate = dbState.updates.find((u) => "revokedAt" in u);
    expect(keyUpdate).toBeDefined();
    expect((keyUpdate!.revokedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});
