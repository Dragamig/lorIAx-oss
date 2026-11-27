import { describe, it, expect } from "vitest";
import { xmlToText } from "./xml-text";

const opts = { blockElements: new Set(["p"]), maxChars: 1_000_000 };

describe("xmlToText", () => {
  it("ne corrompt pas un caractère multioctet à la frontière de 64 Ko", () => {
    // « é » = 2 octets : le préfixe impair place la coupure au milieu du caractère.
    const prefix = "<r><p>" + "a".repeat(65_536 - 7);
    const xml = Buffer.from(prefix + "é".repeat(10) + "</p></r>", "utf8");
    expect(xml[65_535]).toBeGreaterThanOrEqual(0x80);
    const out = xmlToText(xml, opts)!;
    expect(out.text).not.toContain("�");
    expect(out.text).toContain("é".repeat(10));
  });
});
