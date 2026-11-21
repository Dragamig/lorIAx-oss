import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveApiKey = vi.fn();
const checkFeature = vi.fn();
const resolveRequestOrg = vi.fn();

vi.mock("@/lib/auth/api-key", () => ({
  resolveApiKey: (k: string) => resolveApiKey(k),
  hasScope: (s: string[], r: string) => s.includes(r),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/org/resolve-request-org", () => ({
  resolveRequestOrg: (...a: unknown[]) => resolveRequestOrg(...a),
}));
vi.mock("@/lib/auth/rbac", () => ({ canCrossOrgBoundary: () => false }));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({ entitlements: { hasFeature: (f: string) => checkFeature(f) } }),
}));

import { authenticateApiRequest } from "./auth-api";

const resolved = {
  userId: "u1",
  email: "a@b.c",
  name: "A",
  globalRole: "member",
  capabilities: [],
  scopes: ["media:read"],
  keyId: "k1",
};

function req() {
  return new Request("http://x/api/v1/media", {
    headers: { authorization: "Bearer lrx_abc" },
  });
}

describe("authenticateApiRequest : fonctionnalité api_access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveApiKey.mockResolvedValue(resolved);
    resolveRequestOrg.mockResolvedValue({ orgId: "o1", isDefaultOrg: true });
  });

  it("refuse une clé d'API en 403 sans la fonctionnalité api_access", async () => {
    checkFeature.mockResolvedValue(false);
    const r = await authenticateApiRequest(req());
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error.status).toBe(403);
    expect(checkFeature).toHaveBeenCalledWith("api_access");
  });

  it("accepte une clé d'API avec la fonctionnalité api_access", async () => {
    checkFeature.mockResolvedValue(true);
    const r = await authenticateApiRequest(req());
    expect("user" in r).toBe(true);
  });
});
