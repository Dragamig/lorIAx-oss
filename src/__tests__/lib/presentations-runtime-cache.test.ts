/**
 * Cache du runtime servi (revue finale I5) : la réponse est `private`, et
 * `immutable` seulement quand l'URL porte le hachage du pont et du CSS
 * (`b`, calculé une fois au chargement du module). `connect-src 'none'` reste.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/presentations/guards", () => ({
  guardPresentationsModule: vi.fn(async () => null),
}));

async function charger() {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  const route = await import("@/app/api/presentations/runtime/[version]/route");
  const assembly = await import("@/lib/presentations/runtime-assembly");
  const runtime = await import("@/lib/presentations/runtime");
  return { GET: route.GET, ...assembly, ...runtime };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("cache du runtime", () => {
  it("l'URL de l'iframe porte le hachage du pont assemblé", async () => {
    const { runtimeUrl, RUNTIME_ASSEMBLY_HASH } = await charger();
    expect(RUNTIME_ASSEMBLY_HASH).toMatch(/^[0-9a-f]{8,14}$/);
    expect(runtimeUrl("fr")).toContain(`&b=${RUNTIME_ASSEMBLY_HASH}`);
  });

  it("URL versionnée par le hachage : private + immutable, jamais public", async () => {
    const { GET, runtimeUrl, BENTO_RUNTIME_VERSION } = await charger();
    const res = await GET(new Request("http://x" + runtimeUrl("fr")), {
      params: Promise.resolve({ version: BENTO_RUNTIME_VERSION }),
    });
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("private");
    expect(cc).not.toContain("public");
    expect(cc).toContain("immutable");
    expect(res.headers.get("Vary")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
  });

  it("URL sans hachage ou hachage périmé : jamais immutable", async () => {
    const { GET, BENTO_RUNTIME_VERSION } = await charger();
    for (const url of [
      "http://x/api/presentations/runtime/v?lang=fr",
      "http://x/api/presentations/runtime/v?lang=fr&b=ancien",
    ]) {
      const res = await GET(new Request(url), {
        params: Promise.resolve({ version: BENTO_RUNTIME_VERSION }),
      });
      const cc = res.headers.get("Cache-Control") ?? "";
      expect(cc).toContain("private");
      expect(cc).not.toContain("immutable");
    }
  });

  it("le hachage change quand le pont change", async () => {
    vi.resetModules();
    const { RUNTIME_ASSEMBLY_HASH: a } = await import("@/lib/presentations/runtime-assembly");
    vi.resetModules();
    vi.doMock("@/lib/presentations/runtime-bridge-script", () => ({
      RUNTIME_BRIDGE_SCRIPT: "// autre pont",
    }));
    const { RUNTIME_ASSEMBLY_HASH: b } = await import("@/lib/presentations/runtime-assembly");
    vi.doUnmock("@/lib/presentations/runtime-bridge-script");
    expect(a).not.toBe(b);
  });
});
