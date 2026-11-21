/**
 * Non-regression : les sondes de `GET /api/admin/services/health` visent des
 * URL saisies dans les reglages. Aucune ne doit viser un port local, les
 * metadonnees cloud, ni suivre une redirection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  fetch: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "u1", globalRole: "super_admin" })),
}));
vi.mock("@/lib/auth/rbac", () => ({ hasGlobalRole: () => true }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => Object.entries(h.settings).map(([key, value]) => ({ key, value })),
      }),
    }),
  },
}));
vi.mock("@/lib/security/url-validator-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/url-validator-server")>()),
  resolvePublicAddresses: h.resolve,
  assertPublicHostname: h.resolve,
}));

import { GET } from "@/app/api/admin/services/health/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = {};
  h.resolve.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
});

const probed = () => h.fetch.mock.calls.map((c) => String(c[0]));

describe("GET /api/admin/services/health", () => {
  it("services_health_blocks_internal_target (port local)", async () => {
    h.settings = { whisper: { whisperApiUrl: "http://127.0.0.1:22" } };
    const body = await (await GET()).json();
    expect(probed().some((u) => u.includes("127.0.0.1"))).toBe(false);
    expect(body.whisper.status).not.toBe("up");
  });

  it("refuse les metadonnees cloud", async () => {
    h.settings = { ollama: { ollamaBaseUrl: "http://169.254.169.254" } };
    const body = await (await GET()).json();
    expect(probed().some((u) => u.includes("169.254"))).toBe(false);
    expect(body.ollama.status).not.toBe("up");
  });

  it("ne suit aucune redirection", async () => {
    h.settings = { whisper: { whisperApiUrl: "http://whisper.internal:9000" } };
    h.fetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    const body = await (await GET()).json();
    expect(probed().filter((u) => u.includes("whisper.internal"))).toHaveLength(1);
    expect(body.whisper.status).toBe("down");
  });

  it("sonde toujours un service interne legitime du reseau prive", async () => {
    h.settings = { whisper: { whisperApiUrl: "http://whisper.internal:9000" } };
    const body = await (await GET()).json();
    expect(probed().some((u) => u.startsWith("http://whisper.internal:9000"))).toBe(true);
    expect(body.whisper.status).toBe("up");
  });
});
