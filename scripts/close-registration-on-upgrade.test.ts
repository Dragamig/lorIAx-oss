/**
 * Fermeture unique de l'inscription a la mise a jour vers 2.0.0 (oss), avec une base simulee en memoire.
 */
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ModuleId } from "../src/lib/modules/types";
import { closeRegistrationOnUpgrade, REGISTRATION_UPGRADE_MARKER } from "./close-registration-on-upgrade";

type Store = Map<string, Record<string, unknown> | boolean>;

function fakePool(initial: Record<string, Record<string, unknown> | boolean> = {}) {
  const store: Store = new Map(Object.entries(initial));
  let calls = 0;
  const query = async (sql: string, params: unknown[] = []) => {
    calls += 1;
    if (sql.startsWith("WITH m AS")) {
      const key = String(params[0]);
      if (store.has(key)) return { rows: [{ marked: "0", closed: "0" }] };
      store.set(key, true);
      const auth = store.get("auth");
      if (auth && typeof auth === "object" && auth.allowRegistration === true) {
        store.set("auth", { ...auth, allowRegistration: false });
        return { rows: [{ marked: "1", closed: "1" }] };
      }
      return { rows: [{ marked: "1", closed: "0" }] };
    }
    throw new Error(`requete inattendue : ${sql}`);
  };
  return { pool: { query } as unknown as Pool, store, calls: () => calls };
}

const OSS: ModuleId[] = ["ai", "crm"];
const COMMERCIAL: ModuleId[] = ["ai", "crm", "commercial"];

describe("closeRegistrationOnUpgrade", () => {
  it("oss : referme une inscription stockee a true par 1.21.x et pose le marqueur", async () => {
    const { pool, store } = fakePool({ auth: { allowRegistration: true, other: 1 } });
    const res = await closeRegistrationOnUpgrade(pool, OSS);
    expect(res).toEqual({ ran: true, closed: true });
    expect(store.get("auth")).toEqual({ allowRegistration: false, other: 1 });
    expect(store.get(REGISTRATION_UPGRADE_MARKER)).toBe(true);
  });

  it("oss : ne rejoue jamais, un administrateur qui rouvre l'inscription n'est pas refuse", async () => {
    const { pool, store } = fakePool({ auth: { allowRegistration: true } });
    await closeRegistrationOnUpgrade(pool, OSS);
    store.set("auth", { allowRegistration: true });
    const res = await closeRegistrationOnUpgrade(pool, OSS);
    expect(res).toEqual({ ran: false, closed: false });
    expect(store.get("auth")).toEqual({ allowRegistration: true });
  });

  it("oss : base neuve ou reglage deja ferme, rien n'est ecrit dans auth, marqueur pose", async () => {
    const fresh = fakePool();
    expect(await closeRegistrationOnUpgrade(fresh.pool, OSS)).toEqual({ ran: true, closed: false });
    expect(fresh.store.has("auth")).toBe(false);
    expect(fresh.store.get(REGISTRATION_UPGRADE_MARKER)).toBe(true);
    const closed = fakePool({ auth: { allowRegistration: false } });
    expect(await closeRegistrationOnUpgrade(closed.pool, OSS)).toEqual({ ran: true, closed: false });
    expect(closed.store.get("auth")).toEqual({ allowRegistration: false });
  });

  it("edition commerciale : aucune requete, reglage intact", async () => {
    const { pool, store, calls } = fakePool({ auth: { allowRegistration: true } });
    const res = await closeRegistrationOnUpgrade(pool, COMMERCIAL);
    expect(res).toEqual({ ran: false, closed: false });
    expect(calls()).toBe(0);
    expect(store.get("auth")).toEqual({ allowRegistration: true });
    expect(store.has(REGISTRATION_UPGRADE_MARKER)).toBe(false);
  });
});
