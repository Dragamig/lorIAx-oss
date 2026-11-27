import { describe, expect, it } from "vitest";
import { contentEtagSeed, thumbnailEtagSeed, versionEtagSeed } from "./etag";

const row = { id: "m", currentVersion: 3, updatedAt: new Date(5) };

describe("graines d'ETag", () => {
  it("contenu et miniature diffèrent, et suivent version et date", () => {
    expect(contentEtagSeed(row)).toBe("m-v3-5");
    expect(thumbnailEtagSeed(row)).toBe("m-thumb-v3-5");
    expect(contentEtagSeed({ ...row, currentVersion: 4 })).not.toBe(contentEtagSeed(row));
    expect(contentEtagSeed({ ...row, updatedAt: new Date(6) })).not.toBe(contentEtagSeed(row));
  });
  it("une version précise est identifiée par sa ligne (numéro réutilisé après suppression)", () => {
    expect(versionEtagSeed("m", { id: "a", version: 4 })).not.toBe(versionEtagSeed("m", { id: "b", version: 4 }));
  });
});
