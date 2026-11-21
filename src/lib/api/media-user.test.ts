import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/api-key", () => ({
  hasScope: (scopes: string[], s: string) => scopes.includes(s),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitAsync: vi.fn() }));
vi.mock("@/lib/org/resolve-request-org", () => ({ resolveRequestOrg: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({ canCrossOrgBoundary: vi.fn() }));

import { apiUserToSessionUser, requireMediaScope } from "./media-user";
import type { ApiUser } from "./auth-api";

const base: ApiUser = {
  id: "u1",
  email: "a@b.fr",
  name: "A",
  globalRole: "editor",
  capabilities: ["can_create_meetings"] as unknown as ApiUser["capabilities"],
  scopes: ["documents:read"],
  keyId: "k1",
  orgId: "o1",
  isDefaultOrg: false,
};

describe("requireMediaScope", () => {
  it("refuse une clé sans portée média", async () => {
    const r = requireMediaScope(base, "media:read");
    expect(r).not.toBeNull();
    expect(r!.status).toBe(403);
  });
  it("accepte la portée présente, refuse l'autre", () => {
    const u = { ...base, scopes: ["media:read" as const] };
    expect(requireMediaScope(u, "media:read")).toBeNull();
    expect(requireMediaScope(u, "media:write")!.status).toBe(403);
  });
  it("laisse passer la session (scopes null)", () => {
    expect(requireMediaScope({ ...base, scopes: null }, "media:write")).toBeNull();
  });
});

describe("apiUserToSessionUser", () => {
  it("conserve id, rôle global et capacités sans élévation", async () => {
    const s = await apiUserToSessionUser(base);
    expect(s).toEqual({
      id: "u1",
      email: "a@b.fr",
      name: "A",
      globalRole: "editor",
      capabilities: ["can_create_meetings"],
    });
  });
});
