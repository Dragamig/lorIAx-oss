import { describe, expect, it } from "vitest";
import { resolveCurrentSpaceId } from "@/lib/spaces/resolve-current-space";

const accessibleIds = ["a", "b", "c"];

describe("resolveCurrentSpaceId", () => {
  it("privilégie l'espace de la base ouverte sur le paramètre d'URL", () => {
    expect(
      resolveCurrentSpaceId({ accessibleIds, requested: "c", databaseSpaceId: "b", lastSpaceId: "a" })
    ).toBe("b");
  });
  it("sans base ouverte, le paramètre d'URL prime sur le dernier espace", () => {
    expect(resolveCurrentSpaceId({ accessibleIds, requested: "c", lastSpaceId: "a" })).toBe("c");
  });
  it("sinon l'espace de la base ouverte", () => {
    expect(resolveCurrentSpaceId({ accessibleIds, databaseSpaceId: "b", lastSpaceId: "c" })).toBe("b");
  });
  it("sinon le dernier espace choisi", () => {
    expect(resolveCurrentSpaceId({ accessibleIds, lastSpaceId: "c" })).toBe("c");
  });
  it("sinon le premier espace", () => {
    expect(resolveCurrentSpaceId({ accessibleIds })).toBe("a");
  });
  it("rejette un espace non accessible à chaque niveau", () => {
    expect(
      resolveCurrentSpaceId({ accessibleIds, requested: "x", databaseSpaceId: "y", lastSpaceId: "z" })
    ).toBe("a");
    expect(resolveCurrentSpaceId({ accessibleIds, requested: "x", lastSpaceId: "c" })).toBe("c");
  });
  it("retourne null sans espace accessible", () => {
    expect(resolveCurrentSpaceId({ accessibleIds: [], requested: "a" })).toBeNull();
  });
});
