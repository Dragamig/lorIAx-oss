import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// node:dns is mocked so the tests never touch the real resolver: every scenario
// controls exactly which addresses a hostname resolves to.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

// The loopback address of the test server has to be considered publicly
// routable, otherwise no local server could ever be reached by a call that
// exercises the default (allowPrivate: false) path. Everything else keeps the
// real classification, including 169.254.169.254 and the RFC1918 ranges.
vi.mock("@/lib/security/url-validator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/url-validator")>();
  return {
    ...actual,
    isPrivateIp: (address: string) =>
      address === "127.0.0.1" ? false : actual.isPrivateIp(address),
    isPrivateHostname: (hostname: string) =>
      hostname === "local.test" || hostname === "127.0.0.1"
        ? false
        : actual.isPrivateHostname(hostname),
  };
});

import { lookup } from "node:dns/promises";
import {
  SafeFetchError,
  isBlockedTargetError,
  resolvePinnedAddresses,
  safeFetch,
} from "@/lib/security/safe-fetch";

const mockedLookup = vi.mocked(lookup);

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let port: number;
let handler: Handler;
let lastRequest: { host?: string; url?: string; method?: string } | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastRequest = { host: req.headers.host, url: req.url, method: req.method };
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  lastRequest = null;
  handler = (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  };
  mockedLookup.mockReset();
  // Default: local.test points to the test server.
  mockedLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
});

function localUrl(path = "/"): string {
  return `http://local.test:${port}${path}`;
}

describe("resolvePinnedAddresses", () => {
  it("refuse une IP littérale privée", async () => {
    await expect(resolvePinnedAddresses("10.0.0.5")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("refuse une IPv6 littérale entre crochets", async () => {
    await expect(resolvePinnedAddresses("[::1]")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("refuse un nom qui résout vers une adresse privée (C3)", async () => {
    mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
    await expect(resolvePinnedAddresses("rebind.example.com")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("refuse dès qu'une seule des adresses résolues est privée", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ] as never);
    await expect(resolvePinnedAddresses("mixed.example.com")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("refuse un nom qui résout vers une IPv6 unique-local", async () => {
    mockedLookup.mockResolvedValue([{ address: "fd00::1", family: 6 }] as never);
    await expect(resolvePinnedAddresses("v6.example.com")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("accepte une résolution publique et épingle les adresses", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ] as never);
    await expect(resolvePinnedAddresses("public.example.com")).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
  });

  it("autorise le réseau privé avec allowPrivate", async () => {
    mockedLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(resolvePinnedAddresses("ollama.internal", true)).resolves.toEqual([
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(resolvePinnedAddresses("10.0.0.5", true)).resolves.toEqual([
      { address: "10.0.0.5", family: 4 },
    ]);
  });

  it("signale un échec de résolution DNS", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolvePinnedAddresses("unknown.example.com")).rejects.toMatchObject({
      code: "dns_failure",
    });
  });
});

describe("safeFetch — protocoles", () => {
  it("refuse les protocoles non http(s)", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toMatchObject({
      code: "blocked_protocol",
    });
    await expect(safeFetch("ftp://example.com")).rejects.toMatchObject({
      code: "blocked_protocol",
    });
  });

  it("refuse une URL malformée", async () => {
    await expect(safeFetch("pas-une-url")).rejects.toMatchObject({ code: "invalid_url" });
  });
});

describe("safeFetch — requêtes", () => {
  it("effectue la requête et conserve l'en-tête Host d'origine", async () => {
    const res = await safeFetch(localUrl("/data"));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("ok");
    expect(lastRequest?.host).toBe(`local.test:${port}`);
    expect(lastRequest?.url).toBe("/data");
  });

  it("transmet la méthode et le corps", async () => {
    handler = (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: body }));
      });
    };
    const res = await safeFetch(localUrl("/hook"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    await expect(res.json()).resolves.toEqual({ received: '{"a":1}' });
    expect(lastRequest?.method).toBe("POST");
  });

  it("applique le plafond de taille de réponse", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("x".repeat(4096));
    };
    await expect(safeFetch(localUrl("/big"), { maxBytes: 512 })).rejects.toMatchObject({
      code: "response_too_large",
    });
  });

  it("applique le délai maximal", async () => {
    handler = () => {
      // Aucune réponse : la requête doit expirer.
    };
    await expect(safeFetch(localUrl("/slow"), { timeoutMs: 150 })).rejects.toMatchObject({
      code: "timeout",
    });
  });
});

describe("safeFetch — redirections", () => {
  it("refuse une redirection vers une adresse privée (H2)", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    };
    const err = await safeFetch(localUrl("/redirect")).catch((e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err.code).toBe("blocked_address");
    expect(isBlockedTargetError(err)).toBe(true);
  });

  it("refuse une redirection vers un nom résolvant en privé", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: "http://rebind.example.com/" });
      res.end();
    };
    mockedLookup.mockImplementation(async (hostname: string) =>
      hostname === "local.test"
        ? ([{ address: "127.0.0.1", family: 4 }] as never)
        : ([{ address: "192.168.1.10", family: 4 }] as never)
    );
    await expect(safeFetch(localUrl("/redirect"))).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("ne suit aucune redirection quand followRedirects est faux", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/" });
      res.end();
    };
    const res = await safeFetch(localUrl("/redirect"), { followRedirects: false });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://169.254.169.254/");
  });

  it("suit une redirection autorisée et revalide chaque saut", async () => {
    handler = (req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: `http://local.test:${port}/final` });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("arrivée");
    };
    const res = await safeFetch(localUrl("/redirect"));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("arrivée");
  });

  it("plafonne le nombre de sauts", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: `http://local.test:${port}/loop` });
      res.end();
    };
    await expect(safeFetch(localUrl("/loop"), { maxRedirects: 2 })).rejects.toMatchObject({
      code: "too_many_redirects",
    });
  });

  it("repasse en GET et abandonne le corps sur un 303", async () => {
    handler = (req, res) => {
      if (req.url === "/post") {
        res.writeHead(303, { Location: `http://local.test:${port}/after` });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`method=${req.method}`);
    };
    const res = await safeFetch(localUrl("/post"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    await expect(res.text()).resolves.toBe("method=GET");
  });
});
