import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  documents: {}, templates: {}, documentLabels: {}, labels: {},
  documentCollabStates: {}, userDatabases: {}, userDatabaseColumns: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(), isNull: vi.fn(), and: vi.fn(), asc: vi.fn(), desc: vi.fn(), inArray: vi.fn(),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "u1", name: "N", email: "n@x.y" })),
}));
vi.mock("@/lib/org/scoped-space", () => ({
  getSpaceBySlugForRequest: vi.fn(async () => ({
    id: "s1", gitRepoPath: "repo", type: "team", classification: "internal",
  })),
}));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn(async () => "editor") }));
vi.mock("@/lib/storage/filesystem", () => ({ writeDocument: vi.fn(async () => {}) }));
vi.mock("@/lib/git/repository", () => ({
  commitFile: vi.fn(async () => {
    throw new TypeError("Cannot read properties of null (reading 'startsWith')");
  }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/templates/builtin", () => ({ getBuiltinTemplateById: vi.fn() }));
vi.mock("@/lib/editor/template-to-yjs", () => ({ templateContentToYjsState: vi.fn() }));
vi.mock("@/lib/onboarding/progress", () => ({ recordIfRealSpace: vi.fn(async () => {}) }));
vi.mock("@/lib/logger", () => {
  const l = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: () => l };
  return { default: l };
});

import { POST } from "@/app/api/spaces/[slug]/documents/route";

describe("POST /api/spaces/[slug]/documents", () => {
  it("returns a readable JSON error when the git commit throws", async () => {
    const req = new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ title: "Doc" }),
    });
    const res = await POST(req, { params: Promise.resolve({ slug: "s" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});
