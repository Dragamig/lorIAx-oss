/**
 * AZ-27 : service de jetons de vérification d'email et gabarit.
 * Le faux `@/lib/db` enregistre chaque instruction et rend les résultats
 * scriptés ; l'UPDATE ... RETURNING atomique ne rend une ligne qu'une fois.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Op = { kind: string; table: unknown; values?: unknown };
const st = vi.hoisted(() => ({
  ops: [] as Array<{ kind: string; table: unknown; values?: unknown }>,
  selectQueue: [] as unknown[][],
  claimable: true,
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const builder = (kind: string, table: unknown) => {
    const op: Op = { kind, table };
    st.ops.push(op);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      from: (t: unknown) => { op.table = t; return b; },
      values: (v: unknown) => { op.values = v; return b; },
      set: (v: unknown) => { op.values = v; return b; },
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      returning: () => {
        // Seul le premier UPDATE de jeton réclamé rend une ligne.
        if (kind === "update" && table === schema.emailVerificationTokens) {
          if (st.claimable) {
            st.claimable = false;
            return Promise.resolve([{ userId: "u1" }]);
          }
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const out = kind === "select" ? (st.selectQueue.shift() ?? []) : [];
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  };
  const db: Record<string, unknown> = {
    select: () => builder("select", null),
    insert: (t: unknown) => builder("insert", t),
    update: (t: unknown) => builder("update", t),
    delete: (t: unknown) => builder("delete", t),
  };
  db.transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db };
});

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/send", () => ({ sendEmail: sendEmailMock }));
const configuredMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/email-configured", () => ({
  isEmailConfigured: configuredMock,
}));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  hashToken,
  createVerificationToken,
  consumeVerificationToken,
  sendVerificationEmail,
} from "@/lib/auth/email-verification";
import { emailVerificationEmail } from "@/lib/email/templates/email-verification";
import { emailVerificationTokens } from "@/lib/db/schema";

beforeEach(() => {
  st.ops.length = 0;
  st.selectQueue.length = 0;
  st.claimable = true;
  sendEmailMock.mockReset();
  configuredMock.mockReset();
  configuredMock.mockResolvedValue(true);
});

describe("hashToken", () => {
  it("est SHA-256 hex de 64 caractères et stable", () => {
    const h = hashToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).toBe(h);
    expect(hashToken("abd")).not.toBe(h);
  });
});

describe("createVerificationToken", () => {
  it("stocke le haché et jamais le jeton brut, et supprime les précédents", async () => {
    const raw = await createVerificationToken("u1");
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    const del = st.ops.find((o) => o.kind === "delete");
    expect(del?.table).toBe(emailVerificationTokens);
    const ins = st.ops.find((o) => o.kind === "insert");
    const v = ins?.values as { tokenHash: string };
    expect(v.tokenHash).not.toBe(raw);
    expect(v.tokenHash).toBe(hashToken(raw));
    expect(st.ops.indexOf(del!)).toBeLessThan(st.ops.indexOf(ins!));
  });
});

describe("consumeVerificationToken", () => {
  it("verified au premier appel, used au second", async () => {
    expect(await consumeVerificationToken("raw")).toEqual({
      status: "verified",
      userId: "u1",
    });
    st.selectQueue.push([{ usedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) }]);
    expect(await consumeVerificationToken("raw")).toEqual({ status: "used" });
  });

  it("deux appels concurrents : un seul verified", async () => {
    st.selectQueue.push([{ usedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) }]);
    const [a, b] = await Promise.all([
      consumeVerificationToken("raw"),
      consumeVerificationToken("raw"),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["used", "verified"]);
  });

  it("expired si expires_at passé", async () => {
    st.claimable = false;
    st.selectQueue.push([{ usedAt: null, expiresAt: new Date(Date.now() - 1000) }]);
    expect(await consumeVerificationToken("raw")).toEqual({ status: "expired" });
  });

  it("invalid si inconnu", async () => {
    st.claimable = false;
    st.selectQueue.push([]);
    expect(await consumeVerificationToken("raw")).toEqual({ status: "invalid" });
  });
});

describe("sendVerificationEmail", () => {
  const user = { id: "u1", name: "Ada", email: "ada@example.com" };

  it("not_configured : aucun jeton créé, aucun envoi", async () => {
    configuredMock.mockResolvedValue(false);
    expect(await sendVerificationEmail(user)).toEqual({
      sent: false,
      reason: "not_configured",
    });
    expect(st.ops.length).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("cooldown si dernier jeton < 60 s", async () => {
    st.selectQueue.push([{ createdAt: new Date(Date.now() - 10_000) }]);
    expect(await sendVerificationEmail(user)).toEqual({
      sent: false,
      reason: "cooldown",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(st.ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("échec sendEmail => send_failed sans exception", async () => {
    st.selectQueue.push([]);
    sendEmailMock.mockResolvedValue({ success: false, error: "boom" });
    expect(await sendVerificationEmail(user)).toEqual({
      sent: false,
      reason: "send_failed",
    });
    sendEmailMock.mockRejectedValue(new Error("x"));
    st.selectQueue.push([]);
    expect((await sendVerificationEmail(user)).reason).toBe("send_failed");
  });

  it("succès => sent:true et lien contenant le jeton brut", async () => {
    st.selectQueue.push([]);
    sendEmailMock.mockResolvedValue({ success: true });
    expect(await sendVerificationEmail(user)).toEqual({ sent: true });
    const call = sendEmailMock.mock.calls[0][0];
    const ins = st.ops.find((o) => o.kind === "insert");
    const stored = (ins?.values as { tokenHash: string }).tokenHash;
    const raw = /token=([0-9a-f]{64})/.exec(call.text)?.[1];
    expect(raw).toBeTruthy();
    expect(hashToken(raw!)).toBe(stored);
    expect(call.to).toBe("ada@example.com");
  });
});

describe("emailVerificationEmail", () => {
  it("échappe userName et verifyUrl", () => {
    const verifyUrl = "http://x/verify-email?token=a&b=\"c\"";
    const r = emailVerificationEmail({
      userName: '<script>alert(1)</script>"',
      verifyUrl,
      expiresInHours: 24,
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("&quot;");
    expect(r.html).not.toContain('b="c"');
    expect(r.text).toContain(verifyUrl);
    expect(r.subject).toBe("Vérifiez votre adresse email LorIAx");
  });
});
