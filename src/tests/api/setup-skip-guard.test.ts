/**
 * Non-regression AZ-28 : `POST /api/setup/skip` ne doit pas etre ouvert au
 * premier venu. Retour a la parite 1.21.1 (revue finale, I2) : un super
 * administrateur connecte peut aussi ecarter l'assistant sans jeton, et le
 * clore quand l'instance a deja des comptes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  completed: false,
  user: null as null | { globalRole: string },
  anyUser: true,
  writes: [] as string[],
  consumed: 0,
}));

vi.mock("@/lib/setup/bootstrap-token", () => ({
  requireBootstrapToken: vi.fn(async (req: Request) =>
    req.headers.get("x-setup-token") === "bon-jeton"
      ? null
      : NextResponse.json({ error: "Non autorisé" }, { status: 401 }),
  ),
  consumeBootstrapToken: vi.fn(async () => void h.consumed++),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: async () => h.user }));
vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          const rows = () =>
            table === schema.users
              ? h.anyUser
                ? [{ id: "u1" }]
                : []
              : h.completed
                ? [{ key: "setup_completed", value: true }]
                : [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c: any = { where: () => c, limit: async () => rows() };
          return c;
        },
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => void h.writes.push("setup_completed"),
        }),
      }),
    },
  };
});

import { POST } from "@/app/api/setup/skip/route";

function call(token?: string) {
  return POST(
    new NextRequest("http://localhost/api/setup/skip", {
      method: "POST",
      headers: token ? { "x-setup-token": token } : {},
    }),
  );
}

beforeEach(() => {
  h.completed = false;
  h.user = null;
  h.anyUser = true;
  h.writes = [];
  h.consumed = 0;
});

describe("POST /api/setup/skip", () => {
  it("setup_skip_rejects_without_install_key", async () => {
    const res = await call();
    expect([401, 403]).toContain(res.status);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuse un utilisateur connecte qui n'est pas super admin, sans jeton", async () => {
    h.user = { globalRole: "editor" };
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(h.writes).toEqual([]);
  });

  it("setup_skip_rejects_after_setup_completed", async () => {
    h.completed = true;
    const res = await call("bon-jeton");
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("accepte l'appel muni du jeton tant que l'assistant est ouvert", async () => {
    const res = await call("bon-jeton");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("setup_skipped=1");
  });

  it("super admin connecte, sans jeton : « Plus tard » clot l'assistant (parite 1.21.1)", async () => {
    h.user = { globalRole: "super_admin" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("setup_skipped=1");
    expect(h.writes).toEqual(["setup_completed"]);
    expect(h.consumed).toBe(1);
  });

  it("n'enferme pas l'instance : sans aucun compte, rien n'est clos", async () => {
    h.anyUser = false;
    const res = await call("bon-jeton");
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([]);
  });
});
