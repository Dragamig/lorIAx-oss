import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  wheres: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: (col: { name: string }, val: unknown) => ({ op: "eq", col: col.name, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));
vi.mock("@/lib/crypto", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}));
const inv = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("../transport", () => ({ invalidateTransport: (id: string) => inv.invalidate(id) }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          h.wheres.push(w);
          return { limit: async () => h.rows };
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        h.updates.push(v);
        return { where: (w: unknown) => { h.wheres.push(w); return { returning: async () => [{ ...h.rows[0], ...v }] }; } };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserts.push(v);
        return { returning: async () => [{ id: "new", ...v }] };
      },
    }),
    delete: () => ({
      where: (w: unknown) => { h.wheres.push(w); return { returning: async () => h.rows.map((r) => ({ id: r.id })) }; },
    }),
  },
}));

import { getAccountFor, upsertAccount, deleteAccount, accountInputSchema, PasswordRequiredError } from "../accounts";
import { MASKED_SECRET } from "@/lib/settings/secrets";

const base = {
  address: "a@b.fr", displayName: "A", smtpHost: "smtp.b.fr", smtpPort: 465, smtpSecurity: "ssl" as const,
  imapHost: "imap.b.fr", imapPort: 993, imapSecurity: "ssl" as const, password: "pw",
  signature: "", cancelDelaySeconds: 10, pollIntervalMinutes: 5,
};
const stored = {
  id: "m1", organizationId: "org1", userId: "u1", ...base, passwordEnc: "enc:old", status: "ok", statusMessage: null,
};
delete (stored as Record<string, unknown>).password;

beforeEach(() => {
  h.rows = []; h.wheres = []; h.updates = []; h.inserts = [];
});

describe("getAccountFor", () => {
  it("getAccountFor filters on organization and user", async () => {
    h.rows = [stored];
    await getAccountFor("org1", "u1");
    expect(h.wheres[0]).toEqual({
      op: "and",
      args: [{ op: "eq", col: "organization_id", val: "org1" }, { op: "eq", col: "user_id", val: "u1" }],
    });
  });
  it("getAccountFor returns null for another user's account", async () => {
    h.rows = [];
    expect(await getAccountFor("org1", "u2")).toBeNull();
  });
});

describe("upsertAccount", () => {
  it("upsertAccount keeps the stored password when incoming is masked", async () => {
    h.rows = [stored];
    await upsertAccount("org1", "u1", { ...base, password: MASKED_SECRET });
    expect(h.updates[0].passwordEnc).toBe("enc:old");
  });
  it("upsertAccount encrypts a new password and resets status", async () => {
    h.rows = [stored];
    await upsertAccount("org1", "u1", { ...base, password: "new" });
    expect(h.updates[0].passwordEnc).toBe("enc:new");
    expect(h.updates[0].status).toBe("unverified");
  });
  it("upsertAccount refuses to reuse the stored password when a host changes without a password", async () => {
    h.rows = [stored];
    await expect(upsertAccount("org1", "u1", { ...base, password: MASKED_SECRET, smtpHost: "evil.example" })).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(upsertAccount("org1", "u1", { ...base, password: "", imapHost: "evil.example" })).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(upsertAccount("org1", "u1", { ...base, password: null, address: "x@evil.fr" })).rejects.toBeInstanceOf(PasswordRequiredError);
    expect(h.updates).toHaveLength(0);
  });
  it("upsertAccount accepts a changed host when a new password is given", async () => {
    h.rows = [stored];
    await upsertAccount("org1", "u1", { ...base, password: "new", smtpHost: "other.b.fr" });
    expect(h.updates[0].passwordEnc).toBe("enc:new");
  });
  it("upsertAccount inserts when none exists", async () => {
    const r = await upsertAccount("org1", "u1", base);
    expect(h.inserts[0]).toMatchObject({ organizationId: "org1", userId: "u1", passwordEnc: "enc:pw" });
    expect(r.id).toBe("new");
  });
});

describe("deleteAccount", () => {
  it("returns false when nothing matches", async () => {
    expect(await deleteAccount("org1", "u1")).toBe(false);
  });
});

describe("accountInputSchema", () => {
  it("rejects scheme in host and bad ports", () => {
    expect(accountInputSchema.safeParse({ ...base, smtpHost: "smtp://x" }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...base, smtpPort: 0 }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...base, imapPort: 70000 }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...base, smtpSecurity: "none" }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...base, pollIntervalMinutes: 3 }).success).toBe(false);
    expect(accountInputSchema.safeParse(base).success).toBe(true);
  });
});

describe("transport cache invalidation", () => {
  beforeEach(() => inv.invalidate.mockReset());
  it("upsertAccount invalidates the cached transport of the account", async () => {
    h.rows = [stored];
    await upsertAccount("org1", "u1", { ...base, password: "new" });
    expect(inv.invalidate).toHaveBeenCalledWith("m1");
  });
  it("deleteAccount invalidates the cached transport of the account", async () => {
    h.rows = [stored];
    await deleteAccount("org1", "u1");
    expect(inv.invalidate).toHaveBeenCalledWith("m1");
  });
});
