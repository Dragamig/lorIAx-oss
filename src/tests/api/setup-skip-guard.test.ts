/**
 * Non-regression AZ-28 : `POST /api/setup/skip` pose le cookie de report de
 * l'assistant et doit, comme les neuf autres routes de `/api/setup/*`, passer
 * par `guardSetupRoute` (jeton d'amorcage, puis assistant non termine).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ completed: false, tokenOk: false }));

vi.mock("@/lib/setup/bootstrap-token", () => ({
  requireBootstrapToken: vi.fn(async (req: Request) =>
    req.headers.get("x-setup-token") === "bon-jeton"
      ? null
      : NextResponse.json({ error: "Non autorisé" }, { status: 401 }),
  ),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (h.completed ? [{ key: "setup_completed", value: true }] : []),
        }),
      }),
    }),
  },
}));

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
});

describe("POST /api/setup/skip", () => {
  it("setup_skip_rejects_without_install_key", async () => {
    const res = await call();
    expect([401, 403]).toContain(res.status);
    expect(res.headers.get("set-cookie")).toBeNull();
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
});
