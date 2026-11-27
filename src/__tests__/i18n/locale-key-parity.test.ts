import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;

function flat(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

function keys(locale: string): string[] {
  const file = path.resolve(process.cwd(), "messages", `${locale}.json`);
  return flat(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>).sort();
}

describe("parité des clés de messages", () => {
  const fr = keys("fr");
  for (const l of LOCALES.filter((x) => x !== "fr")) {
    it(`${l} a exactement les clés de fr`, () => {
      const other = new Set(keys(l));
      expect(fr.filter((k) => !other.has(k))).toEqual([]);
      const frSet = new Set(fr);
      expect([...other].filter((k) => !frSet.has(k))).toEqual([]);
    });
  }

  it("la médiathèque nomme chaque cible d'usage, tableau blanc compris", () => {
    for (const l of LOCALES) {
      const ks = new Set(keys(l));
      for (const t of ["document", "database_row", "design", "video_project", "brand_kit", "presentation", "whiteboard"]) {
        expect(ks.has(`library.usage.kinds.${t}`), `${l} ${t}`).toBe(true);
      }
    }
  });
});
