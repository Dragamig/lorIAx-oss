import { describe, it, expect } from "vitest";
import { groupViews, scopeChangeBlockedReason, type ViewDef } from "@/components/bases/view-scope";

function v(over: Partial<ViewDef> & { id: string }): ViewDef {
  return {
    name: over.id, type: "grid", isDefault: false, position: 0, config: {},
    scope: "shared", createdBy: "u1", ...over,
  };
}

describe("groupViews", () => {
  it("sépare et conserve l'ordre", () => {
    const views = [v({ id: "a" }), v({ id: "p1", scope: "personal" }), v({ id: "b" }), v({ id: "p2", scope: "personal" })];
    const g = groupViews(views);
    expect(g.shared.map((x) => x.id)).toEqual(["a", "b"]);
    expect(g.personal.map((x) => x.id)).toEqual(["p1", "p2"]);
  });
  it("traite une portée absente comme partagée", () => {
    const legacy = { ...v({ id: "x" }), scope: undefined } as unknown as ViewDef;
    expect(groupViews([legacy]).shared).toHaveLength(1);
  });
});

describe("scopeChangeBlockedReason", () => {
  const base = { viewerId: "u1", sharedCount: 3 };
  it("non-auteur", () => {
    expect(scopeChangeBlockedReason({ ...base, view: v({ id: "a", createdBy: "u2" }), target: "personal" })).toBe("not_author");
    expect(scopeChangeBlockedReason({ ...base, view: v({ id: "a", createdBy: "u2", scope: "personal" }), target: "shared" })).toBe("not_author");
  });
  it("vue par défaut", () => {
    expect(scopeChangeBlockedReason({ ...base, view: v({ id: "a", isDefault: true }), target: "personal" })).toBe("is_default");
  });
  it("dernière partagée", () => {
    expect(scopeChangeBlockedReason({ ...base, sharedCount: 1, view: v({ id: "a" }), target: "personal" })).toBe("last_shared");
  });
  it("partagée sans auteur", () => {
    expect(scopeChangeBlockedReason({ ...base, view: v({ id: "a", createdBy: null }), target: "personal" })).toBe("no_author");
  });
  it("aucun blocage sinon", () => {
    expect(scopeChangeBlockedReason({ ...base, view: v({ id: "a" }), target: "personal" })).toBeNull();
    expect(scopeChangeBlockedReason({ ...base, sharedCount: 1, view: v({ id: "a", scope: "personal" }), target: "shared" })).toBeNull();
  });
});
