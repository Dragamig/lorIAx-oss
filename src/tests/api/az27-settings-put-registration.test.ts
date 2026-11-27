import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as { key: string; value: unknown }[],
  inserts: 0,
  role: "super_admin",
  configured: false,
  configuredCalls: 0,
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => ({
      from: vi.fn(() => Promise.resolve(state.rows)),
    })),
    insert: vi.fn(() => {
      state.inserts += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        values: vi.fn(() => chain),
        onConflictDoUpdate: vi.fn(async () => undefined),
      };
      return chain;
    }),
  };
  return { db: self };
});

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "u1", globalRole: state.role })),
}));
vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/crypto", () => ({ encrypt: (v: string) => v }));
vi.mock("@/lib/email/email-configured", () => ({
  isEmailConfigured: vi.fn(async () => {
    state.configuredCalls += 1;
    return state.configured;
  }),
}));

import { PUT } from "@/app/api/admin/settings/route";

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }) as never
  );
}

describe("PUT /api/admin/settings, ouverture de l'inscription", () => {
  beforeEach(() => {
    state.rows = [];
    state.inserts = 0;
    state.role = "super_admin";
    state.configured = false;
    state.configuredCalls = 0;
  });

  it("ouverture sans SMTP et valeur absente => 409, rien d'écrit", async () => {
    const res = await put({ auth: { allowRegistration: true } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("email_not_configured");
    expect(state.inserts).toBe(0);
  });

  it("ouverture avec SMTP => 200", async () => {
    state.configured = true;
    const res = await put({ auth: { allowRegistration: true } });
    expect(res.status).toBe(200);
    expect(state.inserts).toBe(1);
  });

  it("déjà ouvert et SMTP absent => 200 (pas de transition)", async () => {
    state.rows = [{ key: "auth", value: { allowRegistration: true } }];
    const res = await put({ auth: { allowRegistration: true } });
    expect(res.status).toBe(200);
  });

  it("fermeture => 200 sans consulter le SMTP", async () => {
    const res = await put({ auth: { allowRegistration: false } });
    expect(res.status).toBe(200);
    expect(state.configuredCalls).toBe(0);
  });

  it("non super_admin avec la clé auth => refus existant 403", async () => {
    state.role = "admin";
    const res = await put({ auth: { allowRegistration: true } });
    expect(res.status).toBe(403);
    expect(state.inserts).toBe(0);
  });
});
