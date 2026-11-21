/**
 * Cloisonnement multi-tenant du canal WebSocket de collaboration.
 *
 * Le canal Hocuspocus authentifiait l'utilisateur par JWT puis vérifiait les
 * droits documentaires sans aucun filtre d'organisation, avec un bypass
 * inconditionnel pour les rôles admin/super_admin : un administrateur global de
 * l'org A pouvait ouvrir une session de collaboration sur un document de
 * l'org B à partir de son seul UUID, et donc le lire et le modifier.
 *
 * L'organisation est désormais résolue à l'émission du jeton (contexte HTTP) et
 * transportée dans sa charge utile signée ; la validation refuse tout document
 * hors de cette organisation, admins compris, et refuse (fail-closed) les
 * jetons antérieurs au changement, qui n'en portent pas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[][], call: 0 }));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      state.call += 1;
      return self;
    }),
    from: vi.fn(() => self),
    innerJoin: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(state.rows[state.call - 1] ?? [])),
  };
  return { db: self };
});

const jwtVerify = vi.hoisted(() => vi.fn());
vi.mock("jose", () => ({ jwtVerify }));

import {
  checkDocumentAccess,
  checkCollabDocumentEditAccess,
  verifyWsToken,
} from "@/lib/collab/auth-ws";

const setRows = (...rows: unknown[][]) => {
  state.rows = rows;
  state.call = 0;
};

const docInOrg = (organizationId: string) => [
  {
    spaceId: "space-1",
    createdBy: "someone-else",
    classification: null,
    organizationId,
  },
];

beforeEach(() => {
  setRows();
  jwtVerify.mockReset();
});

describe("checkDocumentAccess — lecture collaborative", () => {
  it("refuse un document d'une autre organisation à un administrateur global", async () => {
    setRows(docInOrg("org-b"));
    await expect(
      checkDocumentAccess("admin-org-a", "doc-org-b", "admin", "org-a")
    ).resolves.toBe(false);
  });

  it("refuse aussi à un super_admin d'une autre organisation", async () => {
    setRows(docInOrg("org-b"));
    await expect(
      checkDocumentAccess("root-org-a", "doc-org-b", "super_admin", "org-a")
    ).resolves.toBe(false);
  });

  it("accepte un administrateur dans l'organisation de son jeton", async () => {
    setRows(docInOrg("org-a"));
    await expect(
      checkDocumentAccess("admin-org-a", "doc-org-a", "admin", "org-a")
    ).resolves.toBe(true);
  });

  it("accepte un membre de l'espace dans l'organisation du jeton", async () => {
    setRows(docInOrg("org-a"), [{ level: "viewer" }]);
    await expect(
      checkDocumentAccess("user-a", "doc-org-a", "editor", "org-a")
    ).resolves.toBe(true);
  });

  it("refuse un jeton dépourvu d'organisation, sans même interroger la base", async () => {
    setRows(docInOrg("org-a"));
    await expect(
      checkDocumentAccess("admin-org-a", "doc-org-a", "admin", null)
    ).resolves.toBe(false);
    expect(state.call).toBe(0);
  });
});

describe("checkCollabDocumentEditAccess — écriture collaborative", () => {
  it("refuse l'écriture sur un document d'une autre organisation à un admin global", async () => {
    setRows([{ globalRole: "admin" }], docInOrg("org-b"));
    await expect(
      checkCollabDocumentEditAccess("admin-org-a", "doc-org-b", "org-a")
    ).resolves.toBe(false);
  });

  it("accepte l'écriture d'un admin dans l'organisation de son jeton", async () => {
    setRows([{ globalRole: "admin" }], docInOrg("org-a"));
    await expect(
      checkCollabDocumentEditAccess("admin-org-a", "doc-org-a", "org-a")
    ).resolves.toBe(true);
  });

  it("accepte un éditeur de l'espace dans l'organisation du jeton", async () => {
    setRows([{ globalRole: "editor" }], docInOrg("org-a"), [{ level: "editor" }]);
    await expect(
      checkCollabDocumentEditAccess("user-a", "doc-org-a", "org-a")
    ).resolves.toBe(true);
  });

  it("refuse un jeton dépourvu d'organisation", async () => {
    setRows([{ globalRole: "admin" }], docInOrg("org-a"));
    await expect(
      checkCollabDocumentEditAccess("admin-org-a", "doc-org-a", null)
    ).resolves.toBe(false);
    expect(state.call).toBe(0);
  });
});

describe("verifyWsToken — organisation portée par le jeton", () => {
  const userRow = [
    {
      id: "user-a",
      email: "a@org-a.test",
      name: "User A",
      globalRole: "admin",
      avatarUrl: null,
      tokenInvalidatedAt: null,
    },
  ];

  it("expose l'organisation signée dans la charge utile", async () => {
    process.env.NEXTAUTH_SECRET = "secret-de-test";
    jwtVerify.mockResolvedValue({ payload: { id: "user-a", orgId: "org-a" } });
    setRows(userRow);
    await expect(verifyWsToken("jeton")).resolves.toMatchObject({
      id: "user-a",
      orgId: "org-a",
    });
  });

  it("renvoie orgId null pour un jeton émis avant le cloisonnement", async () => {
    process.env.NEXTAUTH_SECRET = "secret-de-test";
    jwtVerify.mockResolvedValue({ payload: { id: "user-a" } });
    setRows(userRow);
    await expect(verifyWsToken("jeton-legacy")).resolves.toMatchObject({
      orgId: null,
    });
  });
});
