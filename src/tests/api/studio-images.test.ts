import { describe, it, expect, vi } from "vitest";
import { imageProviders } from "@/lib/db/schema";

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-1",
    globalRole: "member",
  }),
}));

// Depuis le correctif P0-6 (audit du 2026-08-19), les routes du studio
// résolvent l'organisation par `requireOrgScoped`, qui contrôle l'appartenance.
// Ces tests restent fonctionnels : le helper est simulé comme autorisant, le
// cloisonnement lui-même est couvert par `studio-images-siloing.test.ts`.
vi.mock("@/lib/auth/require-org-scoped", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-org-scoped")>();
  return {
    ...actual,
    requireOrgScoped: vi.fn().mockResolvedValue({
      user: { id: "user-1", globalRole: "member" },
      orgId: "org-1",
      orgSlug: "default",
    }),
  };
});

vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn().mockResolvedValue("editor"),
  isGlobalAdmin: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{
      id: "img-1", name: "logo.png", s3Key: "studio/org-1/spaces/sp-1/img-1.png",
      contentType: "image/png", sizeBytes: 1024, organizationId: "org-1",
      spaceId: "sp-1", createdBy: "user-1", createdAt: new Date(), updatedAt: new Date(),
    }]),
  },
}));

vi.mock("@/lib/storage/s3", () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

describe("image_providers schema", () => {
  it("imageProviders table exists and has required columns", () => {
    expect(imageProviders).toBeDefined();
    const cols = Object.keys(imageProviders);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("apiKeyEnc");
    expect(cols).toContain("isEnabled");
    expect(cols).toContain("organizationId");
    expect(cols).toContain("providerType");
    expect(cols).toContain("baseUrl");
  });
});

describe("GET /api/studio/images", () => {
  it("retourne un tableau vide quand aucune image", async () => {
    const { GET } = await import("@/app/api/studio/images/route");
    const req = new Request("http://localhost/api/studio/images?spaceId=sp-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
