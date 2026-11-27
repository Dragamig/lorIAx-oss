import { describe, it, expect } from "vitest";
import { buildDeckFromOutline } from "../build-deck-from-outline";
import { deckSchema } from "../deck";

type El = { type: string; html?: string; role?: string; fontSize?: number };
const els = (deck: { slides: unknown[] }, i: number) =>
  (deck.slides[i] as { elements: El[] }).elements;

describe("buildDeckFromOutline", () => {
  it("produit un diaporama valide pour deckSchema", () => {
    const deck = buildDeckFromOutline("Titre", [
      { title: "A", layout: "cover" },
      { title: "B", bullets: ["x", "y"], notes: "n" },
    ]);
    expect(deckSchema.safeParse(deck).success).toBe(true);
    expect(deck.slides).toHaveLength(2);
    expect(deck.title).toBe("Titre");
  });

  it("plafonne à 12 diapositives", () => {
    const slides = Array.from({ length: 20 }, (_, i) => ({ title: `S${i}` }));
    expect(buildDeckFromOutline("T", slides).slides).toHaveLength(12);
  });

  it("distingue les calques cover, content et closing", () => {
    const deck = buildDeckFromOutline("T", [
      { title: "C", layout: "cover" },
      { title: "D", layout: "content", bullets: ["p"] },
      { title: "E", layout: "closing" },
    ]);
    const cover = els(deck, 0)[0];
    const content = els(deck, 1);
    const closing = els(deck, 2)[0];
    expect(cover.role).toBe("title");
    expect(content.length).toBe(2);
    expect(content[0].fontSize!).toBeLessThan(cover.fontSize!);
    expect(closing.role).toBe("title");
    expect(closing.fontSize).not.toBe(content[0].fontSize);
  });

  it("garde le texte HTML comme texte littéral", () => {
    const deck = buildDeckFromOutline("T", [
      { title: "<img src=x onerror=alert(1)>", bullets: ["<b>gras</b> & co"], notes: "<i>n</i>" },
    ]);
    const e = els(deck, 0);
    expect(e[0].html).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(e[1].html).toContain("&lt;b&gt;gras&lt;/b&gt; &amp; co");
    expect(JSON.stringify(e)).not.toMatch(/<(img|b)\b/);
  });
});
