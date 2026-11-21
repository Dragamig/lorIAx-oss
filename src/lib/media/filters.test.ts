import { describe, expect, it } from "vitest";
import {
  FilterError,
  decodeCursor,
  encodeCursor,
  parseMediaFilters,
  serializeMediaFilters,
} from "./filters";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const parse = (qs: string) => parseMediaFilters(new URLSearchParams(qs));

describe("parseMediaFilters", () => {
  it("applique les défauts", () => {
    expect(parse("")).toEqual({
      view: "all", kinds: [], tagIds: [], sort: "createdAt", dir: "desc", limit: 50,
    });
  });

  it("accepte plusieurs types", () => {
    expect(parse("kind=image&kind=pdf").kinds).toEqual(["image", "pdf"]);
  });

  it("rejette un type inconnu", () => {
    expect(() => parse("kind=exe")).toThrow(FilterError);
    expect(() => parse("kind=exe")).toThrow("Type inconnu");
  });

  it("rejette une vue, un tri ou un sens inconnus", () => {
    expect(() => parse("view=x")).toThrow(FilterError);
    expect(() => parse("sort=x")).toThrow(FilterError);
    expect(() => parse("dir=x")).toThrow(FilterError);
  });

  it("rejette une période inversée", () => {
    expect(() => parse("from=2026-02-01&to=2026-01-01")).toThrow(FilterError);
    expect(() => parse("from=pas-une-date")).toThrow(FilterError);
  });

  it("borne et valide la limite", () => {
    expect(parse("limit=100000").limit).toBe(100);
    expect(() => parse("limit=0")).toThrow(FilterError);
    expect(() => parse("limit=abc")).toThrow(FilterError);
    expect(() => parse("limit=-5")).toThrow(FilterError);
  });

  it("valide folderId et spaceId", () => {
    expect(parse("folderId=none").folderId).toBe("none");
    expect(parse("spaceId=none").spaceId).toBe("none");
    expect(parse(`folderId=${U1}`).folderId).toBe(U1);
    expect(() => parse("folderId=zzz")).toThrow(FilterError);
    expect(() => parse("spaceId=zzz")).toThrow(FilterError);
    expect(() => parse("tagId=zzz")).toThrow(FilterError);
  });

  it("rejette minSize > maxSize", () => {
    expect(() => parse("minSize=10&maxSize=5")).toThrow(FilterError);
    expect(() => parse("minSize=abc")).toThrow(FilterError);
  });

  it("rejette un curseur forgé", () => {
    expect(() => parse("cursor=n'importe quoi")).toThrow(FilterError);
    const c = encodeCursor("filename", "a", U1);
    expect(() => parse(`sort=sizeBytes&cursor=${c}`)).toThrow(FilterError);
    expect(() => parse(`cursor=${c}`)).toThrow(FilterError);
    expect(parse(`sort=filename&cursor=${c}`).cursor).toBe(c);
  });

  it("coupe q à 200 caractères et rogne les espaces", () => {
    expect(parse(`q=${encodeURIComponent("  " + "a".repeat(300) + "  ")}`).q).toBe("a".repeat(200));
    expect(parse("q=%20%20").q).toBeUndefined();
  });
});

describe("serializeMediaFilters", () => {
  it("omet les valeurs par défaut", () => {
    expect(serializeMediaFilters(parse("")).toString()).toBe("");
  });

  it("aller-retour avec 5 filtres combinés", () => {
    const f = parse(
      `view=unused&q=logo&kind=image&kind=pdf&tagId=${U1}&tagId=${U2}&spaceId=${U1}` +
        `&folderId=none&from=2026-01-01&to=2026-02-01&minSize=1&maxSize=900&sort=sizeBytes&dir=asc&limit=20`,
    );
    expect(parseMediaFilters(serializeMediaFilters(f))).toEqual(f);
  });
});

describe("curseur", () => {
  it("aller-retour", () => {
    expect(decodeCursor(encodeCursor("filename", "a.png", U1))).toEqual({ sort: "filename", sortValue: "a.png", id: U1 });
    expect(decodeCursor(encodeCursor("sizeBytes", 42, U1))).toEqual({ sort: "sizeBytes", sortValue: 42, id: U1 });
  });

  it("rejette un curseur forgé", () => {
    expect(() => decodeCursor("n'importe quoi")).toThrow(FilterError);
    expect(() => decodeCursor(Buffer.from('["x",1,"id"]').toString("base64url"))).toThrow(FilterError);
    expect(() => decodeCursor(Buffer.from('{"a":1}').toString("base64url"))).toThrow(FilterError);
    expect(() => decodeCursor(Buffer.from("[null,\"x\"]").toString("base64url"))).toThrow(FilterError);
  });
});

describe("filtre ids", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  it("lit et réécrit les paramètres id", () => {
    const f = parseMediaFilters(new URLSearchParams(`id=${A}&id=${A}`));
    expect(f.ids).toEqual([A]);
    expect(serializeMediaFilters(f).getAll("id")).toEqual([A]);
  });
  it("refuse un id invalide et plus de 100 ids", () => {
    expect(() => parseMediaFilters(new URLSearchParams("id=zzz"))).toThrow(FilterError);
    const many = Array.from({ length: 101 }, (_, i) => `id=00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join("&");
    expect(() => parseMediaFilters(new URLSearchParams(many))).toThrow(FilterError);
  });
});
