import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Reproduit le scénario de prod : LiveKit configuré UNIQUEMENT via le menu admin
// (système_settings, clé "livekit"), AUCUNE variable d'environnement LIVEKIT_*.
// Avant le fix, generateLiveKitToken lisait process.env uniquement et levait
// "LiveKit non configuré" → la route /api/meet/token renvoyait 503 → l'UI
// affichait "LiveKit non configuré sur le serveur".

// Mock du client DB : getLiveKitConfig fait db.select().from().where().limit()
const dbRows: Array<{ key: string; value: unknown }> = [];
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => dbRows,
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  systemSettings: { key: "key", value: "value" },
}));

import { generateLiveKitToken } from "@/lib/meet/livekit-token";

const ENV_KEYS = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  dbRows.length = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("generateLiveKitToken — config en DB sans variables d'env (scénario prod)", () => {
  it("génère un token quand les clés viennent du menu admin (DB) et que l'env est vide", async () => {
    dbRows.push({
      key: "livekit",
      value: {
        livekitEnabled: true,
        livekitUrl: "wss://meet.example.com",
        livekitApiKey: "admin-key-from-db",
        livekitApiSecret: "admin-secret-from-db",
      },
    });

    const token = await generateLiveKitToken({
      roomName: "room-123",
      userId: "user-1",
      userName: "Alice",
      userEmail: "alice@example.com",
    });

    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3); // JWT bien formé
  });

  it("lève une erreur quand ni la DB ni l'env ne fournissent de clés", async () => {
    await expect(
      generateLiveKitToken({
        roomName: "room-123",
        userId: "user-1",
        userName: "Alice",
        userEmail: "alice@example.com",
      })
    ).rejects.toThrow(/non configuré/i);
  });
});
