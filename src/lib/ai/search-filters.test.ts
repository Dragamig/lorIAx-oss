import { describe, expect, it } from "vitest";
import { buildClassificationFilterSql } from "./search-filters";

describe("buildClassificationFilterSql", () => {
  it("n'ecarte rien pour un administrateur global", () => {
    expect(buildClassificationFilterSql({ viewerId: "u1", isGlobalAdmin: true }))
      .toBeNull();
  });

  it("n'ecarte rien quand aucun lecteur n'est fourni", () => {
    expect(buildClassificationFilterSql({})).toBeNull();
  });

  it("ecarte les documents secrets d'autrui pour un utilisateur ordinaire", () => {
    const clause = buildClassificationFilterSql({
      viewerId: "u1",
      isGlobalAdmin: false,
    });
    expect(clause).not.toBeNull();
  });
});
