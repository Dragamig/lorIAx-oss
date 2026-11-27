import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  queue: [] as unknown[][],
  selects: 0,
  inserted: [] as Record<string, unknown>[],
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        values: vi.fn((v: Record<string, unknown>) => {
          dbState.inserted.push(v);
          return chain;
        }),
        returning: vi.fn(async () => [{ id: "user-1", name: "Utilisateur", email: "x@example.test" }]),
        onConflictDoNothing: vi.fn(async () => undefined),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (ok: any, ko: any) => Promise.resolve(undefined).then(ok, ko),
      };
      return chain;
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: vi.fn(async (fn: any) => fn(self)),
  };
  return { db: self };
});

const isRegistrationOpen = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/auth/registration-setting", () => ({ isRegistrationOpen }));

// Politique d'edition (oss) : couverte par ses propres tests ; ici seul le reglage
// `isRegistrationOpen` pilote l'ouverture.
vi.mock("@/lib/auth/registration-policy", () => ({ getRegistrationRefusal: async () => null }));

const sendVerificationEmail = vi.hoisted(() =>
  vi.fn(async (_u: { id: string; name: string; email: string }) => ({ sent: true }) as { sent: boolean; reason?: string })
);
vi.mock("@/lib/auth/email-verification", () => ({ sendVerificationEmail }));

const sendPasswordResetEmail = vi.hoisted(() =>
  vi.fn(async (_u: { id: string; name: string; email: string }) => {})
);
vi.mock("@/lib/auth/password-reset", () => ({ sendPasswordResetEmail }));

const sendEmail = vi.hoisted(() => vi.fn(async (_o: { to: string }) => {}));
vi.mock("@/lib/email/send", () => ({ sendEmail }));

vi.mock("@/lib/git/repository", () => ({ initRepository: vi.fn(async () => {}) }));
vi.mock("@/lib/calendar/auto-provision", () => ({ ensurePersonalCalendar: vi.fn(async () => {}) }));
vi.mock("@/lib/org/get-org-id", () => ({ getDefaultOrgId: vi.fn(async () => "org-1") }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hash") } }));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as status } from "@/app/api/auth/registration-status/route";

let seq = 0;
const fresh = () => `az27-${Date.now()}-${seq++}@example.test`;

function req(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routes = [
  {
    label: "register",
    call: (email: string) =>
      register(req("/api/auth/register", { name: "Utilisateur", email, password: "motdepasse123" })),
    // register: one select (accounts)
    free: () => dbState.queue.push([]),
    known: (row: Record<string, unknown>) => dbState.queue.push([row]),
  },
];

beforeEach(() => {
  // Aucun plafond de licence : le quota est couvert par ses propres tests.
  resetHooksForTests();
  registerHooks({
    usage: { checkUsersLimit: async () => ({ current: 0, max: null, exceeded: false, percentage: 0 }) },
  });
  dbState.queue = [];
  dbState.selects = 0;
  dbState.inserted = [];
  isRegistrationOpen.mockReset();
  isRegistrationOpen.mockResolvedValue(true);
  sendVerificationEmail.mockReset();
  sendVerificationEmail.mockResolvedValue({ sent: true });
  sendEmail.mockClear();
  sendPasswordResetEmail.mockReset();
  sendPasswordResetEmail.mockResolvedValue(undefined);
  delete process.env.REDIS_URL;
});

describe.each(routes)("/api/auth/$label", (r) => {
  it("closed => 403 registration_closed, no insert, no send, accounts table not read", async () => {
    isRegistrationOpen.mockResolvedValue(false);
    r.free();
    const res = await r.call(fresh());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "registration_closed" });
    expect(dbState.inserted).toHaveLength(0);
    expect(dbState.selects).toBe(0);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("open, free address => inserts emailVerifiedAt null, sends once, same response as known address", async () => {
    const email = fresh();
    r.free();
    const created = await r.call(email);
    const createdBody = await created.text();
    expect(created.status).toBe(200);
    expect(dbState.inserted[0]).toMatchObject({ email, emailVerifiedAt: null });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      id: "user-1",
      name: expect.any(String),
      email,
    });

    r.known({ id: "u-old", name: "Ancien", emailVerifiedAt: new Date() });
    const known = await r.call(fresh());
    expect(known.status).toBe(created.status);
    expect(await known.text()).toBe(createdBody);
  });

  it("known verified address => notifyExistingAccount, no verification mail", async () => {
    r.known({ id: "u-old", name: "Ancien", emailVerifiedAt: new Date() });
    const res = await r.call(fresh());
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(dbState.inserted).toHaveLength(0);
  });

  it("known unverified address => reset link, no verification mail, no insert, uniform 200", async () => {
    const email = fresh();
    r.free();
    const created = await r.call(fresh());
    const createdBody = await created.text();
    dbState.queue = [];
    dbState.inserted = [];
    sendVerificationEmail.mockClear();
    r.known({ id: "u-old", name: "Ancien", emailVerifiedAt: null });
    const res = await r.call(email);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(createdBody);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({ id: "u-old", name: "Ancien", email });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(dbState.inserted).toHaveLength(0);
  });

  it("known unverified address, reset send throwing => still uniform 200", async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error("smtp down"));
    r.known({ id: "u-old", name: "Ancien", emailVerifiedAt: null });
    const res = await r.call(fresh());
    expect(res.status).toBe(200);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("verification send reporting sent:false => account still created, 200", async () => {
    sendVerificationEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
    r.free();
    const res = await r.call(fresh());
    expect(res.status).toBe(200);
    expect(dbState.inserted.length).toBeGreaterThan(0);
  });

  it("verification send throwing => still 200", async () => {
    sendVerificationEmail.mockRejectedValue(new Error("boom"));
    r.free();
    const res = await r.call(fresh());
    expect(res.status).toBe(200);
  });
});

describe("/api/auth/registration-status", () => {
  it("returns { open: false } when the reader throws", async () => {
    isRegistrationOpen.mockRejectedValue(new Error("db down"));
    const res = await status();
    expect(await res.json()).toEqual({ open: false });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns { open: true } when open", async () => {
    const res = await status();
    expect(await res.json()).toEqual({ open: true });
  });
});
