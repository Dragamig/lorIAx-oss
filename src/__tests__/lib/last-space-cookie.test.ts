import { describe, it, expect } from "vitest";
import { buildLastSpaceCookie, findSpaceIdBySlug } from "@/lib/spaces/last-space-cookie";

describe("last-space-cookie", () => {
  it("construit le cookie au format attendu par /bases", () => {
    expect(buildLastSpaceCookie("abc/1")).toBe(
      "loriax-space=abc%2F1; path=/; max-age=31536000; samesite=lax"
    );
  });

  it("résout un slug vers un id, null si inconnu ou absent", () => {
    const spaces = [
      { id: "id-a", slug: "perso" },
      { id: "id-b", slug: "equipe" },
    ];
    expect(findSpaceIdBySlug(spaces, "equipe")).toBe("id-b");
    expect(findSpaceIdBySlug(spaces, "nope")).toBeNull();
    expect(findSpaceIdBySlug(spaces, null)).toBeNull();
  });
});
