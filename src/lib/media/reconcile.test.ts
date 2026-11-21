import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { reconcileMediaUsages, RECONCILED_TARGETS, type ReconcileStore, type ReconciledTarget } from "./reconcile";

type U = { id: string; type: string; source: "content" | "explicit"; targetExists: boolean };

function makeStore(usages: U[]): ReconcileStore & { usages: U[] } {
  const stale = (t: ReconciledTarget, s: string) =>
    usages.filter((u) => u.type === t && u.source === s && !u.targetExists);
  return {
    usages,
    countChecked: async (t) => usages.filter((u) => u.type === t).length,
    countStaleExplicit: async (t) => stale(t, "explicit").length,
    countStaleContent: async (t) => stale(t, "content").length,
    listStaleContentIds: async (t, limit) => stale(t, "content").slice(0, limit).map((u) => u.id),
    async deleteContentUsages(ids) {
      let n = 0;
      for (const id of ids) {
        const i = usages.findIndex((u) => u.id === id && u.source === "content");
        if (i >= 0) { usages.splice(i, 1); n++; }
      }
      return n;
    },
  };
}

const fixture = (): U[] => [
  { id: "a", type: "document", source: "content", targetExists: false }, // retiré
  { id: "b", type: "database_row", source: "explicit", targetExists: false }, // conservé
  { id: "c", type: "document", source: "content", targetExists: true }, // média en corbeille, document existant
  { id: "d", type: "design", source: "content", targetExists: false }, // type non réconcilié
];

describe("reconcileMediaUsages", () => {
  it("retire le contenu orphelin, garde l'explicite et l'existant", async () => {
    const store = makeStore(fixture());
    const r = await reconcileMediaUsages({ store });
    expect(r).toEqual({ checked: 3, removed: 1, keptExplicit: 1 });
    expect(store.usages.map((u) => u.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("dryRun ne supprime rien et rend les mêmes comptes", async () => {
    const store = makeStore(fixture());
    const r = await reconcileMediaUsages({ store, dryRun: true });
    expect(r).toEqual({ checked: 3, removed: 1, keptExplicit: 1 });
    expect(store.usages).toHaveLength(4);
  });

  it("second passage : removed 0", async () => {
    const store = makeStore(fixture());
    await reconcileMediaUsages({ store });
    expect((await reconcileMediaUsages({ store })).removed).toBe(0);
  });

  it("traite plus d'un lot de 500", async () => {
    const many: U[] = Array.from({ length: 1200 }, (_, i) => ({ id: `x${i}`, type: "brand_kit", source: "content", targetExists: false }));
    const store = makeStore(many);
    expect((await reconcileMediaUsages({ store })).removed).toBe(1200);
  });

  it("ne couvre que les types dont la table est connue", () => {
    expect(Object.keys(RECONCILED_TARGETS).sort()).toEqual(["brand_kit", "database_row", "document", "video_project"]);
  });
});
