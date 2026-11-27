/**
 * C1 (revue finale, tache 40) : /api/auth/register applique le reglage
 * « Inscription ouverte » cote serveur et refuse tant que l'instance n'a pas
 * de super administrateur ni d'assistant termine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { systemSettings, users } from "@/lib/db/schema";
import type { ModuleId } from "@/lib/modules/types";

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

const OSS: ModuleId[] = ["ai", "crm"];
const COMMERCIAL: ModuleId[] = ["ai", "crm", "commercial"];

describe("getRegistrationRefusal, edition oss", () => {
  it("refuse tant qu'aucun super admin n'existe, assistant non termine", async () => {
    expect((await getRegistrationRefusal(OSS))?.status).toBe(403);
  });

  it("I-B : refuse sans super admin meme quand setup_completed est vrai et l'inscription ouverte", async () => {
    h.settings = [
      { key: "setup_completed", value: true },
      { key: "auth", value: { allowRegistration: true } },
    ];
    const r = await getRegistrationRefusal(OSS);
    expect(r?.status).toBe(403);
    expect(r?.error).toMatch(/pas encore configur/);
  });

  it("refuse quand le reglage auth.allowRegistration vaut false", async () => {
    h.superAdmins = 1;
    h.settings = [{ key: "auth", value: { allowRegistration: false } }];
    const r = await getRegistrationRefusal(OSS);
    expect(r?.status).toBe(403);
    expect(r?.error).toMatch(/inscription/i);
  });

  it("defaut ferme quand le reglage n'a jamais ete enregistre", async () => {
    h.superAdmins = 1;
    h.settings = [{ key: "setup_completed", value: true }];
    expect((await getRegistrationRefusal(OSS))?.status).toBe(403);
    h.settings = [{ key: "auth", value: { defaultRole: "editor" } }];
    expect((await getRegistrationRefusal(OSS))?.status).toBe(403);
  });

  it("accepte avec un super admin et l'inscription explicitement ouverte", async () => {
    h.superAdmins = 1;
    h.settings = [{ key: "auth", value: { allowRegistration: true } }];
    expect(await getRegistrationRefusal(OSS)).toBeNull();
  });
});

describe("getRegistrationRefusal, edition commerciale", () => {
  it("fermee sans reglage explicite (AZ-27 de main), mais sans exigence de super admin ni d'assistant termine", async () => {
    expect((await getRegistrationRefusal(COMMERCIAL))?.status).toBe(403);
    h.settings = [{ key: "auth", value: { defaultRole: "editor" } }];
    expect((await getRegistrationRefusal(COMMERCIAL))?.status).toBe(403);
    h.settings = [{ key: "auth", value: { allowRegistration: true } }];
    expect(await getRegistrationRefusal(COMMERCIAL)).toBeNull();
  });

  it("un false explicite de l'administrateur ferme la route", async () => {
    h.settings = [{ key: "auth", value: { allowRegistration: false } }];
    expect((await getRegistrationRefusal(COMMERCIAL))?.status).toBe(403);
  });

  it("un true explicite reste ouvert", async () => {
    h.settings = [{ key: "auth", value: { allowRegistration: true } }];
    expect(await getRegistrationRefusal(COMMERCIAL)).toBeNull();
  });
});
