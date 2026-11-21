/**
 * Charge utile des événements de partage de document : elle porte son espace.
 *
 * Piège posé par le lot 6 plutôt que faille du jour. Le filtre d'espace de
 * l'émission des webhooks a été resserré : « un webhook déclaré sur un espace
 * ne reçoit que les événements de CET espace, et un événement sans espace n'en
 * concerne donc aucun » (cf. `webhooks-dispatch-org.test.ts`). Or les deux
 * événements de partage ne portaient pas d'espace. L'impact est nul aujourd'hui,
 * `share.created` et `share.revoked` n'étant pas proposés à l'abonnement, mais
 * le premier qui les y ajouterait constaterait qu'aucun webhook d'espace ne les
 * reçoit, sans rien pour l'expliquer.
 *
 * L'espace est disponible des deux côtés, il est simplement joint à la charge
 * utile. Ces tests observent l'argument réellement remis à
 * `dispatchWebhookEvent` : c'est l'émetteur qui est en cause, pas le module de
 * diffusion, dont le filtre reste inchangé.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const DOCUMENT = "doc-1";
const ESPACE = "space-1";
const ORG = "org-acme";
const PARTAGE = "share-1";

const h = vi.hoisted(() => ({
  /** Lignes rendues par les `select` successifs : document, puis espace. */
  lectures: [] as unknown[][],
}));

vi.mock("@/lib/db", () => {
  const chaine = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
      set: () => self,
      where: () => self,
      values: () => self,
      limit: () => Promise.resolve(h.lectures.shift() ?? []),
      returning: () => Promise.resolve([{ id: "share-1", token: "jeton", createdAt: new Date() }]),
      then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
        Promise.resolve(h.lectures.shift() ?? []).then(resoudre, rejeter),
    };
    return self;
  };
  return { db: { select: () => chaine(), insert: () => chaine(), update: () => chaine() } };
});

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "user-1",
    email: "u@test.tld",
    name: "Utilisatrice",
    globalRole: "editor",
  })),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentEditAccess: vi.fn(async () => true),
  checkDocumentViewAccess: vi.fn(async () => true),
}));

vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

// Le module de diffusion est espionné, pas simulé dans son comportement :
// l'objet observé est la charge utile que l'émetteur lui remet.
vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchWebhookEvent: vi.fn(),
  organizationIdOfSpace: vi.fn(async () => ORG),
}));

import { POST, DELETE } from "@/app/api/documents/[id]/share/route";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";

const mockDispatch = vi.mocked(dispatchWebhookEvent);

/** Charge utile du dernier événement émis. */
function derniereCharge(): Record<string, unknown> {
  expect(mockDispatch.mock.calls.length).toBeGreaterThan(0);
  return mockDispatch.mock.calls.at(-1)![1];
}

const documentLu = [{ id: DOCUMENT, spaceId: ESPACE, classification: "public" }];
const espaceLu = [{ id: ESPACE, classification: "public", organizationId: ORG }];

beforeEach(() => {
  vi.clearAllMocks();
  h.lectures = [];
});

describe("share.created : la charge utile porte l'espace du document", () => {
  it("joint `spaceId`, sans quoi aucun webhook d'espace ne verrait le partage", async () => {
    h.lectures = [documentLu, espaceLu, []];

    const res = await POST(
      new NextRequest("http://acme.test/api/documents/doc-1/share", { method: "POST" }),
      { params: Promise.resolve({ id: DOCUMENT }) }
    );

    expect(res.status).toBe(200);
    expect(mockDispatch.mock.calls.at(-1)![0]).toBe("share.created");
    expect(derniereCharge()).toHaveProperty("spaceId", ESPACE);
  });
});

describe("share.revoked : même charge utile, même espace", () => {
  it("joint `spaceId` à la révocation", async () => {
    h.lectures = [documentLu];

    const res = await DELETE(
      new NextRequest("http://acme.test/api/documents/doc-1/share", {
        method: "DELETE",
        body: JSON.stringify({ shareId: PARTAGE }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: DOCUMENT }) }
    );

    expect(res.status).toBe(200);
    expect(mockDispatch.mock.calls.at(-1)![0]).toBe("share.revoked");
    expect(derniereCharge()).toHaveProperty("spaceId", ESPACE);
  });
});
