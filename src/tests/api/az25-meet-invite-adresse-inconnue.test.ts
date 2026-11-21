/**
 * AZ-25 : la route publique de jeton visio invité indexait son quota sur
 * `getClientIp`, qui rend la CONSTANTE « unknown » quand aucune adresse n'est
 * déterminable. Tous les clients anonymes tombaient donc dans le MÊME seau de
 * vingt demandes par minute : n'importe qui fermait l'accès invité à tout le
 * monde. La classe de défaut visée par AZ-25, manquée sur cette route.
 *
 * La limitation de débit n'est PAS doublée : le test exerce le vrai module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("@/lib/meet/livekit-token", () => ({
  generateLiveKitToken: vi.fn(async () => "jeton"),
}));
vi.mock("@/lib/meet/livekit-config", () => ({
  getLiveKitConfig: vi.fn(async () => ({ url: "wss://exemple.test" })),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/public/meet/token/route";

let seq = 0;

const demande = (ip?: string) =>
  new NextRequest("http://localhost/api/public/meet/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify({
      shareToken: `jeton-${seq++}`,
      roomName: "salle",
      displayName: "Invité",
    }),
  });

beforeEach(() => {
  delete process.env.REDIS_URL;
});

describe("AZ-25 : le jeton visio invité ne partage pas un seau « adresse inconnue »", () => {
  it("laisse passer bien plus de vingt demandes sans en-tête d'adresse", async () => {
    // Sous l'ancienne clé, la 21e était refusée par le seau commun.
    for (let i = 0; i < 30; i++) {
      const res = await POST(demande());
      expect(res.status, `demande anonyme n° ${i + 1}`).not.toBe(429);
    }
  });

  it("garde un quota serré pour un client dont l'adresse est connue", async () => {
    const ip = `198.51.100.${(seq % 200) + 1}-${Date.now()}`;

    for (let i = 0; i < 20; i++) {
      expect((await POST(demande(ip))).status).not.toBe(429);
    }
    expect((await POST(demande(ip))).status).toBe(429);
  });

  it("n'enferme pas les clients identifiés dans le seau des anonymes", async () => {
    const sature = `198.51.100.240-${Date.now()}`;
    for (let i = 0; i < 21; i++) await POST(demande(sature));
    expect((await POST(demande(sature))).status).toBe(429);

    // Un autre client, identifié lui aussi, garde son propre seau.
    const autre = `198.51.100.241-${Date.now()}`;
    expect((await POST(demande(autre))).status).not.toBe(429);
  });
});
