import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { safeFetch } from "@/lib/security/safe-fetch";

/**
 * Ce fichier n'utilise aucun mock : il vérifie sur un vrai serveur local que la
 * dérogation `allowPrivate` laisse fonctionner l'auto-hébergement (Ollama,
 * Whisper, LiveKit sur localhost) et que son absence bloque bien la même cible.
 */

let server: http.Server;
let port: number;

beforeAll(async () => {
  // Écoute en IPv4 seulement, comme Ollama sur 127.0.0.1:11434 par défaut.
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("safeFetch — dérogation allowPrivate", () => {
  it("joint un service local via son nom d'hôte localhost", async () => {
    const res = await safeFetch(`http://localhost:${port}/api/tags`, {
      allowPrivate: true,
      timeoutMs: 5000,
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ models: [] });
  });

  it("joint un service local via une IP privée littérale", async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/api/tags`, {
      allowPrivate: true,
      timeoutMs: 5000,
    });
    expect(res.status).toBe(200);
  });

  it("bloque la même cible sans la dérogation", async () => {
    await expect(safeFetch(`http://localhost:${port}/api/tags`)).rejects.toMatchObject({
      code: "blocked_address",
    });
    await expect(safeFetch(`http://127.0.0.1:${port}/api/tags`)).rejects.toMatchObject({
      code: "blocked_address",
    });
  });
});
