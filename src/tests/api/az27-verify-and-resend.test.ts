/**
 * AZ-27 task 5: POST /api/auth/verify-email and /api/auth/resend-verification.
 * The real rate-limit module is exercised (memory backend); the verification
 * service and the database are faked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  queue: [] as unknown[][],
  lookups: 0,
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => {
      dbState.lookups += 1;
      return Promise.resolve(dbState.queue.shift() ?? []);
    }),
  };
  return { db: self };
});

const consumeVerificationToken = vi.hoisted(() => vi.fn());
const findUserIdByToken = vi.hoisted(() => vi.fn());
const sendVerificationEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/email-verification", () => ({
  consumeVerificationToken,
  findUserIdByToken,
  sendVerificationEmail,
}));

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as verifyPOST } from "@/app/api/auth/verify-email/route";
import { POST as resendPOST } from "@/app/api/auth/resend-verification/route";
import { authIdentityBucket, isQuotaExceeded } from "@/lib/rate-limit";

let ipCounter = 0;
const uniqueIp = () => {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.7`;
};

function req(path: string, body: unknown, ip?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ip) headers["x-forwarded-for"] = ip;
  return new Request(`http://localhost/api/auth/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const MESSAGE =
  "Si un compte en attente existe, un nouveau lien vient d'être envoyé.";

beforeEach(() => {
  dbState.queue = [];
  dbState.lookups = 0;
  consumeVerificationToken.mockReset();
  findUserIdByToken.mockReset();
  sendVerificationEmail.mockReset();
  sendVerificationEmail.mockResolvedValue({ sent: true });
  delete process.env.REDIS_URL;
});


describe("POST /api/auth/verify-email", () => {
  it("jeton valide => 200 verified", async () => {
    consumeVerificationToken.mockResolvedValue({ status: "verified", userId: "u1" });
    const res = await verifyPOST(req("verify-email", { token: "abc" }, uniqueIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "verified" });
  });

  it("second appel (double clic, deux onglets) => 400 used", async () => {
    consumeVerificationToken
      .mockResolvedValueOnce({ status: "verified", userId: "u1" })
      .mockResolvedValueOnce({ status: "used" });
    const ip = uniqueIp();
    const first = await verifyPOST(req("verify-email", { token: "abc" }, ip));
    const second = await verifyPOST(req("verify-email", { token: "abc" }, ip));
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ status: "used" });
  });

  it("expiré => 400 expired", async () => {
    consumeVerificationToken.mockResolvedValue({ status: "expired" });
    const res = await verifyPOST(req("verify-email", { token: "abc" }, uniqueIp()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: "expired" });
  });

  it("inconnu => 400 invalid", async () => {
    consumeVerificationToken.mockResolvedValue({ status: "invalid" });
    const res = await verifyPOST(req("verify-email", { token: "abc" }, uniqueIp()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: "invalid" });
  });

  it("corps sans token => 400, rien consommé", async () => {
    const res = await verifyPOST(req("verify-email", {}, uniqueIp()));
    expect(res.status).toBe(400);
    expect(consumeVerificationToken).not.toHaveBeenCalled();
  });

  it("IP indéterminable => palier IP sauté (pas de seau partagé)", async () => {
    consumeVerificationToken.mockResolvedValue({ status: "invalid" });
    for (let i = 0; i < 35; i++) {
      const res = await verifyPOST(req("verify-email", { token: `n${i}` }));
      expect(res.status).toBe(400);
    }
  });

  it("31e appel de la même IP => 429", async () => {
    consumeVerificationToken.mockResolvedValue({ status: "invalid" });
    const ip = uniqueIp();
    for (let i = 0; i < 30; i++) {
      const res = await verifyPOST(req("verify-email", { token: `t${i}` }, ip));
      expect(res.status).toBe(400);
    }
    const res = await verifyPOST(req("verify-email", { token: "t31" }, ip));
    expect(res.status).toBe(429);
  });
});

describe("POST /api/auth/resend-verification", () => {
  const unverified = {
    id: "u1",
    name: "Léa",
    email: "lea@example.com",
    emailVerifiedAt: null,
  };

  it("normalise l'email (majuscules, espaces) avant recherche", async () => {
    dbState.queue.push([unverified]);
    const res = await resendPOST(
      req("resend-verification", { email: " Lea@Example.COM " }, uniqueIp()),
    );
    expect(res.status).toBe(200);
    // Same bucket as the normalised address: the 60 s tier is already consumed.
    const exceeded = await isQuotaExceeded(
      `resend-verification:email:${authIdentityBucket("lea@example.com")}`,
      [{ maxRequests: 1, windowMs: 60_000 }],
    );
    expect(exceeded).toBe(true);
  });

  it("compte inconnu => 200 identique, aucun envoi", async () => {
    dbState.queue.push([]);
    const res = await resendPOST(
      req("resend-verification", { email: "inconnu@example.com" }, uniqueIp()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: MESSAGE });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("compte déjà vérifié => 200 identique, aucun envoi", async () => {
    dbState.queue.push([{ ...unverified, emailVerifiedAt: new Date() }]);
    const res = await resendPOST(
      req("resend-verification", { email: "verifie@example.com" }, uniqueIp()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: MESSAGE });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("compte non vérifié => sendVerificationEmail appelé", async () => {
    dbState.queue.push([unverified]);
    const res = await resendPOST(
      req("resend-verification", { email: "attente@example.com" }, uniqueIp()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: MESSAGE });
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      id: "u1",
      name: "Léa",
      email: "lea@example.com",
    });
  });

  it("2e demande dans les 60 s => 200 uniforme, un seul envoi", async () => {
    dbState.queue.push([unverified], [unverified]);
    const first = await resendPOST(
      req("resend-verification", { email: "double@example.com" }, uniqueIp()),
    );
    const second = await resendPOST(
      req("resend-verification", { email: "double@example.com" }, uniqueIp()),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ message: MESSAGE });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it("corps { token } expiré => envoi pour le propriétaire du jeton", async () => {
    findUserIdByToken.mockResolvedValue("u1");
    dbState.queue.push([unverified]);
    const res = await resendPOST(
      req("resend-verification", { token: "vieux" }, uniqueIp()),
    );
    expect(res.status).toBe(200);
    expect(findUserIdByToken).toHaveBeenCalledWith("vieux");
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it("corps { token } inconnu => 200 uniforme, aucun envoi", async () => {
    findUserIdByToken.mockResolvedValue(null);
    const res = await resendPOST(
      req("resend-verification", { token: "inconnu" }, uniqueIp()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: MESSAGE });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("21e appel de la même IP => 429", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 20; i++) {
      dbState.queue.push([]);
      const res = await resendPOST(
        req("resend-verification", { email: `ip${i}@example.com` }, ip),
      );
      expect(res.status).toBe(200);
    }
    const res = await resendPOST(
      req("resend-verification", { email: "ip21@example.com" }, ip),
    );
    expect(res.status).toBe(429);
  });

  it("IP indéterminable => palier IP sauté, palier adresse appliqué", async () => {
    for (let i = 0; i < 25; i++) {
      dbState.queue.push([]);
      const res = await resendPOST(
        req("resend-verification", { email: `noip${i}@example.com` }),
      );
      expect(res.status).toBe(200);
    }
    dbState.queue.push([unverified], [unverified]);
    await resendPOST(req("resend-verification", { email: "noip-same@example.com" }));
    await resendPOST(req("resend-verification", { email: "noip-same@example.com" }));
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });
});
