/**
 * Projection de réponse : un PATCH ne doit jamais renvoyer `contentText`.
 *
 * L'écriture n'implique pas la lecture : un utilisateur autorisé à modifier un
 * document `secret` sans pouvoir le lire récupérait son contenu via le
 * `.returning()` nu de la mise à jour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  returningArg: vi.fn(),
}));

const FULL_ROW = { id: "d", title: "T", classification: "internal", contentText: "SECRET CONTENT" };

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.where = self;
  c.innerJoin = self;
  c.orderBy = self;
  c.limit = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(h.selectQueue.shift() ?? []),
    delete: () => ({ where: async () => {} }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          // Simule Drizzle : sans projection, toutes les colonnes ; avec une
          // projection, uniquement les clés demandées.
          returning: async (cols?: Record<string, unknown>) => {
            h.returningArg(cols);
            if (!cols) return [FULL_ROW];
            return [Object.fromEntries(Object.keys(cols).filter((k) => k in FULL_ROW).map((k) => [k, (FULL_ROW as Record<string, unknown>)[k]]))];
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: async () => ({ id: "u", name: "U", email: "u@x", globalRole: "editor" }),
}));
vi.mock("@/lib/api/auth-api", () => ({
  authenticateApiRequest: async () => ({
    user: { id: "u", name: "U", email: "u@x", orgId: "org", globalRole: "editor", scopes: [] },
  }),
  requireScope: () => null,
}));
vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  checkDocumentViewAccess: async () => false,
  checkDocumentEditAccess: async () => true,
  checkDocumentDeclassifyAccess: async () => false,
}));
vi.mock("@/lib/storage/filesystem", () => ({ readDocument: async () => "", writeDocument: async () => {} }));
vi.mock("@/lib/git/repository", () => ({ commitFile: async () => "sha" }));
vi.mock("@/lib/graph/links", () => ({ parseWikiLinks: () => [] }));
vi.mock("@/lib/ai/embeddings", () => ({ indexDocument: async () => {} }));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/lib/notifications", () => ({ createNotifications: async () => {} }));
vi.mock("@/lib/logger", () => ({ default: { error: () => {}, warn: () => {} } }));
vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchWebhookEvent: () => {},
  organizationIdOfSpace: async () => "org",
}));

import { PATCH as restPatch } from "@/app/api/documents/[id]/route";
import { PATCH as v1Patch } from "@/app/api/v1/documents/[id]/route";

const ctx = { params: Promise.resolve({ id: "d" }) };
const req = () =>
  new Request("http://x/api/documents/d", { method: "PATCH", body: JSON.stringify({ title: "Nouveau" }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.selectQueue.push(
    [{ id: "d", spaceId: "s", title: "T", filePath: "f.md", isFolder: false, classification: "secret", createdBy: "autre", contentText: "SECRET CONTENT" }],
    [{ id: "s", gitRepoPath: "r", organizationId: "org", classification: "internal" }],
    [],
  );
});

describe("PATCH : réponse sans contentText", () => {
  it("patch_response_omits_content_text_for_viewer_below_clearance (REST)", async () => {
    const res = await restPatch(req(), ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRET CONTENT");
    expect(JSON.parse(text)).not.toHaveProperty("contentText");
  });

  it("patch_response_omits_content_text_for_viewer_below_clearance (api/v1)", async () => {
    const res = await v1Patch(req(), ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRET CONTENT");
  });
});
