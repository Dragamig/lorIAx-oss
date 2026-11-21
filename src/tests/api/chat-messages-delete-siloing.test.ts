/**
 * Non-régression AZ-06 (audit du 2026-08-19).
 *
 * `DELETE /api/chat/messages/[id]` chargeait le message par identifiant nu,
 * sans jamais confronter l'organisation du canal à celle de la requête. La
 * dispense `isAdmin` court-circuitait ensuite le contrôle d'appartenance au
 * canal : un `admin` global, désormais borné à ses propres organisations,
 * supprimait le message d'un canal appartenant à un autre tenant.
 *
 * Le correctif charge le canal (`chatChannels`), le compare à
 * `getRequestOrgId(user)` et répond 404 (jamais 403, pour ne pas révéler
 * l'existence du message) dès que l'organisation diffère ou est irrésolue.
 *
 * Motif de vérification : « répond 403 ou 404 ET ne fait rien ». La
 * suppression étant un soft-delete, l'absence d'effet de bord est prouvée par
 * le non-appel de `db.update` (ainsi que de `db.insert` et `db.delete`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestOrgId: vi.fn(),
  selectQueue: [] as unknown[][],
  selectCalls: { count: 0 },
  updateCalls: { count: 0 },
  insertCalls: { count: 0 },
  deleteCalls: { count: 0 },
}));

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
    limit: vi.fn().mockResolvedValue(rows),
    returning: vi.fn().mockResolvedValue(rows),
  };
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.getRequestOrgId }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectQueue[h.selectCalls.count] ?? [];
      h.selectCalls.count += 1;
      return chain(rows);
    }),
    update: vi.fn(() => {
      h.updateCalls.count += 1;
      return chain([]);
    }),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return chain([]);
    }),
    delete: vi.fn(() => {
      h.deleteCalls.count += 1;
      return chain([]);
    }),
  },
}));

import { DELETE } from "@/app/api/chat/messages/[id]/route";

/** Admin global, borné à ses organisations depuis AZ-06. */
const ADMIN = { id: "mallory", email: "admin@acme.tld", globalRole: "admin" };

/** Auteur légitime du message, simple utilisateur de l'organisation du canal. */
const AUTEUR = { id: "alice", email: "alice@victime.tld", globalRole: "user" };

/** Message du canal du tenant victime, vivant (jamais soft-supprimé). */
const MESSAGE = {
  id: "msg-1",
  channelId: "chan-victime",
  authorId: "alice",
  content: "confidentiel",
  createdAt: new Date(),
  deletedAt: null,
};

/**
 * File des lignes rendues par `db.select()`, dans l'ordre où la route
 * interroge : message, canal, puis appartenance au canal.
 */
function queue(...rows: unknown[][]) {
  h.selectQueue.length = 0;
  for (const r of rows) h.selectQueue.push(r);
  h.selectCalls.count = 0;
}

function attendreAucunEffetDeBord() {
  expect(h.updateCalls.count).toBe(0);
  expect(h.insertCalls.count).toBe(0);
  expect(h.deleteCalls.count).toBe(0);
}

const ctx = { params: Promise.resolve({ id: "msg-1" }) };
const req = () =>
  new NextRequest("http://victime.example.com/api/chat/messages/msg-1", {
    method: "DELETE",
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.updateCalls.count = 0;
  h.insertCalls.count = 0;
  h.deleteCalls.count = 0;
  queue();
});

describe("Chat : suppression d'un message d'une autre organisation (AZ-06)", () => {
  it("répond 404 et ne soft-supprime rien pour un admin dont l'organisation de requête diffère", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN);
    // Le canal appartient au tenant victime, la requête est résolue sur `acme`.
    queue([MESSAGE], [{ organizationId: "org-victime" }]);
    h.getRequestOrgId.mockResolvedValue("org-acme");

    const res = await DELETE(req(), ctx);

    expect(res.status).toBe(404);
    // Message puis canal : l'appartenance n'est même pas interrogée.
    expect(h.selectCalls.count).toBe(2);
    attendreAucunEffetDeBord();
  });

  it("répond 404 et ne soft-supprime rien quand l'organisation de requête est irrésolue", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN);
    queue([MESSAGE], [{ organizationId: "org-victime" }]);
    // Fail-closed : `null` vaut « aucun accès », jamais « accès global ».
    h.getRequestOrgId.mockResolvedValue(null);

    const res = await DELETE(req(), ctx);

    expect(res.status).toBe(404);
    attendreAucunEffetDeBord();
  });
});

describe("Chat : usage légitime préservé", () => {
  it("soft-supprime le message de son auteur, membre du canal, dans la même organisation", async () => {
    h.getSessionUser.mockResolvedValue(AUTEUR);
    queue(
      [MESSAGE],
      [{ organizationId: "org-victime" }],
      [{ channelId: "chan-victime" }]
    );
    h.getRequestOrgId.mockResolvedValue("org-victime");

    const res = await DELETE(req(), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.updateCalls.count).toBe(1);
  });
});
