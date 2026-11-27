/**
 * AZ-27 task 5: a successful password reset proves mailbox ownership. The
 * password change and the verification share one transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

type Write = {
  table: string;
  values: Record<string, unknown>;
  where: string;
};

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  committed: [] as unknown[],
  failOn: null as string | null,
  toWrite: null as ((table: unknown, values: Record<string, unknown>, cond: unknown) => unknown) | null,
}));

vi.mock("@/lib/auth/revoke-sessions", () => ({
  revokeUserSessions: vi.fn(async () => {}),
  revokeUserApiKeys: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => {
  const makeUpdater = (sink: unknown[]) => ({
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          sink.push(state.toWrite!(table, values, cond));
        },
      }),
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: () => self,
    from: () => self,
    where: () => self,
    limit: () => Promise.resolve(state.selectRows),
    // Buffered writes, committed only when the callback resolves.
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const buffer: unknown[] = [];
      await fn(makeUpdater(buffer));
      state.committed.push(...buffer);
    },
    ...makeUpdater(state.committed),
  };
  return { db: self };
});

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "$2a$12$nouveau"), compare: vi.fn() },
}));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/auth/reset-password/route";

const dialect = new PgDialect();

let ipCounter = 0;
const makeRequest = () => {
  ipCounter += 1;
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: JSON.stringify({ token: `jeton-${ipCounter}`, password: "motdepasse-long" }),
  });
};

const writes = () => state.committed as Write[];
const writesTo = (table: string) => writes().filter((w) => w.table === table);

beforeEach(() => {
  state.selectRows = [];
  state.committed = [];
  state.failOn = null;
  state.toWrite = (table, values, cond) => {
    const name = getTableName(table as never);
    if (state.failOn === name) throw new Error(`échec sur ${name}`);
    return { table: name, values, where: dialect.sqlToQuery(cond as never).sql };
  };
});

const validReset = () => {
  state.selectRows = [{ id: "reset-1", userId: "user-1", token: "jeton", usedAt: null }];
};

describe("POST /api/auth/reset-password et vérification de l'adresse", () => {
  it("marque vérifié un compte non vérifié (UPDATE users conditionné à NULL)", async () => {
    validReset();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const verif = writesTo("users").find((w) => w.values.emailVerifiedAt instanceof Date);
    expect(verif).toBeDefined();
    expect(verif!.where).toMatch(/"email_verified_at" is null/);
  });

  it("un compte déjà vérifié garde sa date d'origine (le UPDATE exige NULL)", async () => {
    validReset();
    await POST(makeRequest());
    const verifWrites = writesTo("users").filter((w) => "emailVerifiedAt" in w.values);
    expect(verifWrites).toHaveLength(1);
    // Never an unconditional write of emailVerifiedAt: a stored date survives.
    expect(verifWrites[0].where).toMatch(/is null/);
    const passwordWrite = writesTo("users").find((w) => "passwordHash" in w.values);
    expect("emailVerifiedAt" in passwordWrite!.values).toBe(false);
  });

  it("invalide les jetons de vérification en attente (used_at posé)", async () => {
    validReset();
    await POST(makeRequest());
    const tokens = writesTo("email_verification_tokens");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].values.usedAt).toBeInstanceOf(Date);
    expect(tokens[0].where).toMatch(/"used_at" is null/);
  });

  it("jeton de réinitialisation invalide ou expiré => aucune écriture", async () => {
    state.selectRows = [];
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(state.committed).toHaveLength(0);
  });

  it("même transaction : l'échec de la vérification annule le changement de mot de passe", async () => {
    validReset();
    state.failOn = "email_verification_tokens";
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(state.committed).toHaveLength(0);
  });

  it("même transaction : le changement de mot de passe et la vérification sont validés ensemble", async () => {
    validReset();
    await POST(makeRequest());
    expect(writesTo("users").some((w) => "passwordHash" in w.values)).toBe(true);
    expect(writesTo("password_reset_tokens")).toHaveLength(1);
    expect(writesTo("email_verification_tokens")).toHaveLength(1);
  });
});
