import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;

function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value === "string") {
    out[prefix] = value;
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  }
  return out;
}

function load(locale: string): Record<string, string> {
  const file = path.resolve(process.cwd(), "messages", `${locale}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (!json.mailing || typeof json.mailing !== "object") throw new Error(`${locale}.json: namespace mailing absent`);
  return flatten(json.mailing);
}

function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Record<string, string>>;
const reference = Object.keys(messages.fr).sort();

describe("libellés du module mailing", () => {
  it("les 7 fichiers contiennent exactement les mêmes clés mailing.*", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(reference);
    }
  });

  it("les clés attendues par l'écran Ma boîte mail existent en français", () => {
    const required = [
      "settings.title", "settings.provider.infomaniak", "settings.test.button", "settings.save.button",
      "settings.error.retry", "settings.signature.cancelDelaySeconds",
    ];
    for (const key of required) expect(reference, key).toContain(key);
  });

  it("aucune valeur vide ni identique à la clé", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(value, `${locale}.${key}`).not.toBe(key);
      }
    }
  });

  it("aucune valeur ne contient un tiret cadratin ou demi-cadratin", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(/[—–]/.test(value), `${locale}.${key}`).toBe(false);
      }
    }
  });

  it("les placeholders sont identiques dans les 7 langues pour une même clé", () => {
    for (const key of reference) {
      const expected = placeholders(messages.fr[key]);
      for (const locale of LOCALES) {
        expect(placeholders(messages[locale][key]), `${locale}.${key}`).toEqual(expected);
      }
    }
  });
});
