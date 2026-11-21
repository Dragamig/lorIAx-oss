/**
 * Portée d'organisation transmise au RECLASSEMENT, surface par surface.
 *
 * Le reclassement envoie des extraits de documents à un point de terminaison
 * externe : ce point est celui d'un fournisseur d'IA, et il ne doit jamais
 * être celui d'un tenant voisin. `rerankCandidates` reçoit donc sa portée en
 * paramètre, et son repli est la portée d'instance.
 *
 * Deux surfaces du même produit divergeaient (revue adversariale du
 * 2026-08-20) : le chat sur documents passait son organisation, la recherche
 * générale la connaissait et ne la passait pas. Sur une instance
 * multi-organisations, la recherche retombait donc sur la portée d'instance,
 * ne trouvait aucun fournisseur de reclassement et perdait le reclassement, en
 * silence. La base de connaissances d'aide, elle, ne disait rien de sa portée
 * alors qu'elle en a une, et une seule : celle de l'instance, `kb_chunks`
 * portant la documentation du produit, la même pour tous les tenants.
 *
 * Ces tests observent l'ARGUMENT réellement remis à `rerankCandidates` par les
 * vraies fonctions appelantes. `organizationId` est désormais une clé
 * OBLIGATOIRE de ses options : on vérifie donc la présence de la clé autant
 * que sa valeur, puisque c'est l'omission qui était le défaut.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  orgCourante: "org-acme" as string | null,
  execute: vi.fn(() => Promise.resolve({ rows: [] as unknown[] })),
  /** Portée d'instance simulée : une instance mono-organisation. */
  porteeInstance: "org-instance-unique" as string | null,
}));

vi.mock("@/lib/db", () => {
  const chaine = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      where: () => self,
      orderBy: () => self,
      groupBy: () => self,
      limit: () => Promise.resolve([]),
      then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
        Promise.resolve([] as unknown[]).then(resoudre, rejeter),
    };
    return self;
  };
  return {
    db: {
      execute: () => h.execute(),
      select: () => chaine(),
    },
  };
});

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn() }));

vi.mock("@/lib/org/get-request-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/get-request-org")>()),
  getRequestOrgId: vi.fn(async () => h.orgCourante),
}));

vi.mock("@/lib/org/get-org-id", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/get-org-id")>()),
  getOrgSlugFromHeaders: vi.fn(async () => "acme"),
  getOrgId: vi.fn(async () => h.orgCourante),
}));

vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  getAccessibleSpaceIds: vi.fn(async () => ["space-1"]),
  isGlobalAdmin: vi.fn(async () => false),
}));

vi.mock("@/lib/ai/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embeddings")>()),
  isEmbeddingConfiguredAsync: vi.fn(async () => false),
  searchSemantic: vi.fn(async () => []),
  generateEmbedding: vi.fn(async () => [0.1]),
}));

// Seule la lecture du nombre d'organisations actives est simulée : c'est une
// requête, pas une décision. La règle « une seule organisation active vaut
// portée de cette organisation, plusieurs valent portée instance seule » reste
// exercée par `ai-provider-resolver-org-scope.test.ts`.
vi.mock("@/lib/ai/provider-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider-resolver")>()),
  instanceProviderScope: vi.fn(async () => h.porteeInstance),
}));

vi.mock("@/lib/ai/rerank", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rerank")>()),
  rerankCandidates: vi.fn(async (_q: string, items: unknown[]) => items),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { rerankCandidates } from "@/lib/ai/rerank";
import { searchKb } from "@/lib/kb/kb";

const mockUser = vi.mocked(getSessionUser);
const mockRerank = vi.mocked(rerankCandidates);

/** Options remises au dernier appel de `rerankCandidates`. */
function dernieresOptions(): Record<string, unknown> {
  expect(mockRerank.mock.calls.length).toBeGreaterThan(0);
  return mockRerank.mock.calls.at(-1)![2] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.orgCourante = "org-acme";
  h.porteeInstance = "org-instance-unique";
  h.execute.mockResolvedValue({ rows: [] });
  mockUser.mockResolvedValue({
    id: "user-1",
    email: "u@test.tld",
    name: "Utilisateur",
    globalRole: "editor",
  } as never);
});

async function rechercher() {
  const { GET } = await import("@/app/api/search/route");
  return GET(new NextRequest("http://acme.test/api/search?q=fournisseur"));
}

describe("GET /api/search : le reclassement reçoit l'organisation de la requête", () => {
  it("transmet l'organisation que la route a déjà résolue", async () => {
    const res = await rechercher();

    expect(res.status).toBe(200);
    expect(dernieresOptions()).toHaveProperty("organizationId", "org-acme");
  });

  it("suit l'organisation de la requête, tenant par tenant", async () => {
    h.orgCourante = "org-victime";
    await rechercher();

    expect(dernieresOptions().organizationId).toBe("org-victime");
    expect(dernieresOptions().organizationId).not.toBe("org-acme");
  });

  it("ne laisse pas la portée à deviner : la clé est toujours écrite", async () => {
    // C'est l'omission qui était le défaut, pas une mauvaise valeur : un champ
    // absent retombait sur la portée d'instance sans que rien ne le signale.
    await rechercher();

    expect(Object.keys(dernieresOptions())).toContain("organizationId");
  });
});

describe("base de connaissances d'aide : portée d'instance, écrite et non déduite", () => {
  it("passe explicitement la portée d'instance au reclassement", async () => {
    h.execute.mockResolvedValue({
      rows: [
        { source: "a.md", title: "A", chunk_text: "texte a", score: 0 },
        { source: "b.md", title: "B", chunk_text: "texte b", score: 0 },
      ],
    });

    await searchKb("fournisseur", 5, "user-1");

    expect(dernieresOptions()).toHaveProperty("organizationId", "org-instance-unique");
  });

  it("ne prend jamais l'organisation d'un tenant, même quand la requête en a une", async () => {
    h.orgCourante = "org-acme";
    h.porteeInstance = null;
    h.execute.mockResolvedValue({
      rows: [
        { source: "a.md", title: "A", chunk_text: "texte a", score: 0 },
        { source: "b.md", title: "B", chunk_text: "texte b", score: 0 },
      ],
    });

    await searchKb("fournisseur", 5, "user-1");

    expect(dernieresOptions().organizationId).toBeNull();
  });
});
