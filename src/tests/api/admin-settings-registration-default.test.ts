/**
 * Tache 40h : l'ecran « Systeme » affiche la valeur effective de l'inscription
 * ouverte quand le reglage est absent. Sans cela, le formulaire (defaut false)
 * ecrivait un `false` explicite au premier enregistrement, et fermait
 * l'inscription d'une instance commerciale.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  modules: [] as string[],
  rows: [] as { key: string; value: unknown }[],
  written: [] as { key: string; value: unknown }[],
}));

vi.mock("@/lib/modules/registry.generated", () => ({
  get INCLUDED_MODULE_IDS() {
    return h.modules;
  },
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "sa", globalRole: "super_admin" })),
}));
vi.mock("@/lib/crypto", () => ({ encrypt: (v: string) => v }));
vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/db/schema", () => ({ systemSettings: { key: "key" } }));
vi.mock("@/lib/settings/module-toggles", () => ({
  stripModuleToggleFields: (_k: string, value: unknown) => ({ skip: false, value }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: () => Promise.resolve(h.rows) })),
    insert: vi.fn(() => ({
      values: (v: { key: string; value: unknown }) => {
        h.written.push(v);
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    })),
  },
}));

import { GET, PUT } from "@/app/api/admin/settings/route";
import { resolveAllowRegistration } from "@/lib/auth/registration-default";

beforeEach(() => {
  h.rows = [{ key: "general", value: { appName: "LorIAx" } }];
  h.written = [];
});

describe("GET /api/admin/settings : inscription ouverte, reglage absent", () => {
  it("edition commerciale : le formulaire recoit ouvert, et enregistrer sans toucher laisse l'inscription ouverte", async () => {
    h.modules = ["commercial"];
    const body = await (await GET()).json();
    expect(body.auth.allowRegistration).toBe(true);

    // Le formulaire renvoie ce qu'il a lu, interrupteur intact.
    await PUT(
      new NextRequest("http://localhost/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth: { allowRegistration: body.auth.allowRegistration } }),
      })
    );
    const stored = h.written.find((w) => w.key === "auth")?.value as {
      allowRegistration: boolean;
    };
    expect(stored.allowRegistration).toBe(true);
    expect(resolveAllowRegistration(stored.allowRegistration, ["commercial"])).toBe(true);
  });

  it("edition oss : le formulaire recoit ferme", async () => {
    h.modules = ["crm"];
    const body = await (await GET()).json();
    expect(body.auth.allowRegistration).toBe(false);
  });

  it("un reglage explicite n'est pas remplace", async () => {
    h.modules = ["commercial"];
    h.rows = [{ key: "auth", value: { allowRegistration: false, defaultRole: "viewer" } }];
    const body = await (await GET()).json();
    expect(body.auth).toEqual({ allowRegistration: false, defaultRole: "viewer" });
  });
});
