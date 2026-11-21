/**
 * Proxy sans module commercial : organisation unique, aucune resolution par
 * sous-domaine, aucun cookie lrx_org. N'importe pas le baril commercial.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const t = vi.hoisted(() => ({ token: { orgSlug: "acme" } as null | { orgSlug: string } }));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => t.token) }));
vi.mock("@/lib/meet/livekit-config", () => ({ getLiveKitUrlForCsp: vi.fn(async () => "") }));
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));
vi.mock("@/i18n/routing", () => ({ routing: {} }));
vi.mock("@/lib/modules/hooks.http.generated", () => ({ collectIncludedHttpHooks: () => ({}) }));

import { NextRequest } from "next/server";

async function freshProxy() {
  vi.resetModules();
  return (await import("@/proxy")).default;
}
const slugOf = (r: Response) => r.headers.get("x-middleware-request-x-org-slug");

describe("proxy neutre (sans commercial)", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "example.com"));
  afterEach(() => vi.unstubAllEnvs());

  it("neutral_proxy_ignores_subdomain_and_sets_no_parent_cookie", async () => {
    const proxy = await freshProxy();
    const res = await proxy(new NextRequest("http://localhost/api/auth/session", { headers: { host: "acme.example.com", cookie: "lrx_org=old" } }));
    expect(res.headers.get("set-cookie") ?? "").not.toContain("lrx_org");
    const v1 = await proxy(new NextRequest("http://localhost/api/v1/x", { headers: { host: "acme.example.com" } }));
    expect(slugOf(v1)).toBe("default");
  });

  it("neutral_proxy_does_not_clear_cookie_on_signout", async () => {
    const proxy = await freshProxy();
    const res = await proxy(new NextRequest("http://localhost/api/auth/signout", { headers: { cookie: "lrx_org=acme" } }));
    expect(res.headers.get("set-cookie") ?? "").not.toContain("lrx_org");
  });

  it("path_mode_still_resolves_org_slug_in_both_editions (noyau)", async () => {
    const proxy = await freshProxy();
    for (const p of ["/org/zed/docs", "/fr/org/zed/docs"]) {
      const res = await proxy(new NextRequest(`http://localhost${p}`, { headers: { host: "localhost" } }));
      expect(slugOf(res)).toBe("zed");
    }
  });

  it("le noyau ne traite plus /signup comme une page publique", async () => {
    t.token = null;
    const proxy = await freshProxy();
    const res = await proxy(new NextRequest("http://localhost/signup"));
    expect(res.status).toBe(307);
    t.token = { orgSlug: "acme" };
  });
});
