import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;
const NAMESPACES = ["basesTotals", "basesViews"] as const;

const REQUIRED_KEYS: Record<(typeof NAMESPACES)[number], string[]> = {
  basesTotals: [
    "menuLabel", "amountColumn", "amountColumnNone", "currency", "showWeighted", "lanesTable",
    "closedLane", "weight", "weightDisabledReason", "weightSuffix", "closedBadge", "unpriced",
    "weightedLine", "bannerCards", "bannerOpen", "bannerOpenSum", "bannerWeighted", "bannerPartial",
    "multiValueNotice", "inactiveMissingColumn", "inactiveBadType", "emptyPrompt", "savedToast",
    "undoneToast", "saveError", "retry", "undo", "emptyLane", "filterBarFilters", "filterBarSorts",
  ],
  basesViews: [
    "groupShared", "groupPersonal", "scopeLabel", "scopePersonal", "scopeShared", "scopePersonalHint",
    "scopeSharedHint", "createdToast", "scopeChangedSharedToast", "scopeChangedPersonalToast",
    "changeScope", "changeScopeDisabledNotAuthor", "changeScopeDisabledDefault",
    "changeScopeDisabledLastShared", "deletedToast", "deleteDisabledLastShared", "nameTaken",
  ],
};

const EM_DASH = "—";
const EN_DASH = "–";

type Messages = Record<string, Record<string, string>>;

function load(locale: string): Messages {
  const file = path.resolve(process.cwd(), "messages", `${locale}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const out: Messages = {};
  for (const ns of NAMESPACES) {
    const value = json[ns];
    if (value === undefined || value === null || typeof value !== "object") {
      throw new Error(`${locale}.json: namespace ${ns} absent`);
    }
    out[ns] = value as Record<string, string>;
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Messages>;

describe("bases totals and views messages", () => {
  it("les 7 fichiers contiennent exactement les mêmes clés pour basesTotals et basesViews", () => {
    for (const ns of NAMESPACES) {
      const reference = Object.keys(messages.fr[ns]).sort();
      for (const key of REQUIRED_KEYS[ns]) expect(reference, `fr.${ns}.${key}`).toContain(key);
      for (const locale of LOCALES) {
        expect(Object.keys(messages[locale][ns]).sort(), `${locale}.${ns}`).toEqual(reference);
      }
    }
  });

  it("aucune valeur vide ni identique à la clé", () => {
    for (const locale of LOCALES) {
      for (const ns of NAMESPACES) {
        for (const [key, value] of Object.entries(messages[locale][ns])) {
          expect(value.trim().length, `${locale}.${ns}.${key}`).toBeGreaterThan(0);
          expect(value, `${locale}.${ns}.${key}`).not.toBe(key);
        }
      }
    }
  });

  it("aucune valeur ne contient un tiret cadratin ou demi-cadratin", () => {
    for (const locale of LOCALES) {
      for (const ns of NAMESPACES) {
        for (const [key, value] of Object.entries(messages[locale][ns])) {
          expect(value.includes(EM_DASH), `${locale}.${ns}.${key}`).toBe(false);
          expect(value.includes(EN_DASH), `${locale}.${ns}.${key}`).toBe(false);
        }
      }
    }
  });

  it("les placeholders ICU {count}, {amount}, {weight} sont identiques dans les 7 langues pour une même clé", () => {
    for (const ns of NAMESPACES) {
      for (const key of Object.keys(messages.fr[ns])) {
        const reference = placeholders(messages.fr[ns][key]);
        for (const locale of LOCALES) {
          expect(placeholders(messages[locale][ns][key]), `${locale}.${ns}.${key}`).toEqual(reference);
        }
      }
    }
  });
});
