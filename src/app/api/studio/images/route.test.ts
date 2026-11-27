import { describe, it, expect, vi } from "vitest";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "logo.png",
  storageKey: "studio/org-1/logo.png",
  mimeType: "image/png",
  sizeBytes: 10,
  organizationId: "org-1",
  spaceId: null,
  uploadedBy: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

vi.mock("@/lib/auth/require-org-scoped", () => ({
  OrgScopeError: class OrgScopeError extends Error {
    response = new Response(null, { status: 404 });
  },
  requireOrgScoped: vi.fn().mockResolvedValue({
    user: { id: "user-1", globalRole: "member" },
    orgId: "org-1",
    orgSlug: "default",
  }),
}));

vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "from", "where"]) chain[k] = () => chain;
  chain.orderBy = () => Promise.resolve([row]);
  return { db: chain };
});

describe("GET /api/studio/images", () => {
  it("rend des urls /api/media/<id>", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/studio/images") as never);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].url).toBe(`/api/media/${row.id}`);
  });
});
