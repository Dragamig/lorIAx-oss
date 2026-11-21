/**
 * C1 (revue finale, tache 40) : /api/auth/register applique le reglage
 * « Inscription ouverte » cote serveur et refuse tant que l'instance n'a pas
 * de super administrateur ni d'assistant termine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { systemSettings, users } from "@/lib/db/schema";

const h = vi.hoisted(() => ({
  settings: [] as Array<{ key: string; value: unknown }>,
  superAdmins: 0,
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (rows: () => unknown[]): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {
      where: () => c,
      limit: async () => rows(),
      then: (res: (v: unknown) => unknown) => res(rows()),
    };
    return c;
  };
  return {
    db: {
      select: () => ({
        from: (table: unknown) =>
          table === users
            ? chain(() => (h.superAdmins > 0 ? [{ id: "admin" }] : []))
            : chain(() => h.settings),
      }),
    },
  };
});

import { getRegistrationRefusal } from "@/lib/auth/registration-policy";

void systemSettings;

beforeEach(() => {
  h.settings = [];
  h.superAdmins = 0;
});

describe("getRegistrationRefusal", () => {
  it("refuse tant que l'assistant n'est pas termine et qu'aucun super admin n'existe", async () => {
    const r = await getRegistrationRefusal();
    expect(r?.status).toBe(403);
  });

  it("refuse quand le reglage auth.allowRegistration vaut false", async () => {
    h.settings = [
      { key: "setup_completed", value: true },
      { key: "auth", value: { allowRegistration: false } },
    ];
    const r = await getRegistrationRefusal();
    expect(r?.status).toBe(403);
    expect(r?.error).toMatch(/inscription/i);
  });

  it("accepte quand l'assistant est termine et l'inscription ouverte", async () => {
    h.settings = [
      { key: "setup_completed", value: true },
      { key: "auth", value: { allowRegistration: true } },
    ];
    expect(await getRegistrationRefusal()).toBeNull();
  });

  it("defaut ferme quand le reglage n'a jamais ete enregistre (installation neuve ou venue de 1.21.x)", async () => {
    h.settings = [{ key: "setup_completed", value: true }];
    expect((await getRegistrationRefusal())?.status).toBe(403);
    h.settings = [
      { key: "setup_completed", value: true },
      { key: "auth", value: { defaultRole: "editor" } },
    ];
    expect((await getRegistrationRefusal())?.status).toBe(403);
  });

  it("instance amorcee hors assistant mais pourvue d'un super admin : seul le reglage compte", async () => {
    h.superAdmins = 1;
    expect((await getRegistrationRefusal())?.status).toBe(403);
    h.settings = [{ key: "auth", value: { allowRegistration: true } }];
    expect(await getRegistrationRefusal()).toBeNull();
  });
});
