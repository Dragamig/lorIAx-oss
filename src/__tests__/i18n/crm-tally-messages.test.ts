import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;

function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value === "string") out[prefix] = value;
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

function load(locale: string): Record<string, string> {
  const file = path.resolve(process.cwd(), "messages", `${locale}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as { crm?: { tally?: unknown } };
  if (!json.crm?.tally) throw new Error(`${locale}.json: crm.tally absent`);
  return flatten(json.crm.tally);
}

const placeholders = (v: string) => [...new Set([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Record<string, string>>;
const reference = Object.keys(messages.fr).sort();

describe("messages crm.tally.*", () => {
  it("mêmes clés et mêmes placeholders dans les 7 locales, aucune valeur vide, aucun tiret cadratin ni demi-cadratin", () => {
    expect(reference.length).toBeGreaterThanOrEqual(100);
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(reference);
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(/[—–]/.test(value), `${locale}.${key}`).toBe(false);
        expect(placeholders(value), `${locale}.${key}`).toEqual(placeholders(messages.fr[key]));
      }
    }
  });
});
