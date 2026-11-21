/**
 * Non-régression AZ-06 (audit du 2026-08-19).
 *
 * `POST /api/labels` crée un label global : une taxonomie d'instance, sans
 * organisation, visible par tous les tenants. La création était ouverte au
 * rôle `admin` alors que le `PATCH` et le `DELETE` de `labels/[id]` sont déjà
 * réservés au `super_admin`. Un admin d'organisation, désormais borné à ses
 * propres organisations, polluait donc l'espace de noms de toute l'instance.
 *
 * Le correctif exige `super_admin` et renvoie `INSTANCE_ADMIN_ONLY_MESSAGE`.
 *
 * Motif de vérification : « répond 403 ET ne fait rien ». L'absence d'effet de
 * bord est prouvée par le non-appel de `db.insert`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  insertCalls: { count: 0 },
  updateCalls: { count: 0 },
  deleteCalls: { count: 0 },
}));

const LABEL = { id: "lab-1", name: "Confidentiel", color: "#112233", isGlobal: true };

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    from: vi.fn().mockReturnThis(),
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
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => chain([])),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return chain([LABEL]);
    }),
    update: vi.fn(() => {
      h.updateCalls.count += 1;
      return chain([]);
    }),
    delete: vi.fn(() => {
      h.deleteCalls.count += 1;
      return chain([]);
    }),
  },
}));

import { POST } from "@/app/api/labels/route";
import { INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";

const asUser = (globalRole: string) => ({
  id: "u",
  name: "U",
  email: "u@x.com",
  globalRole,
});

const createReq = () =>
  new NextRequest("http://acme.example.com/api/labels", {
    method: "POST",
    body: JSON.stringify({ name: "Confidentiel", color: "#112233", isGlobal: true }),
    headers: { "Content-Type": "application/json" },
  });

function attendreAucunEffetDeBord() {
  expect(h.insertCalls.count).toBe(0);
  expect(h.updateCalls.count).toBe(0);
  expect(h.deleteCalls.count).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.insertCalls.count = 0;
  h.updateCalls.count = 0;
  h.deleteCalls.count = 0;
});

describe("Labels globaux : création réservée au super_admin (AZ-06)", () => {
  it("répond 403 et ne crée rien pour un admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(asUser("admin"));

    const res = await POST(createReq());

    expect(res.status).toBe(403);
    // Message explicite : l'action relève de l'administration d'instance.
    await expect(res.json()).resolves.toEqual({ error: INSTANCE_ADMIN_ONLY_MESSAGE });
    attendreAucunEffetDeBord();
  });

  it("répond 403 et ne crée rien pour un éditeur", async () => {
    h.getSessionUser.mockResolvedValue(asUser("editor"));

    const res = await POST(createReq());

    expect(res.status).toBe(403);
    attendreAucunEffetDeBord();
  });
});

describe("Labels globaux : usage légitime préservé", () => {
  it("crée le label global pour un super_admin", async () => {
    h.getSessionUser.mockResolvedValue(asUser("super_admin"));

    const res = await POST(createReq());

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ id: "lab-1", isGlobal: true });
    expect(h.insertCalls.count).toBe(1);
  });
});
