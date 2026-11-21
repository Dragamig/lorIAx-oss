import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;

// Clés déjà lues par la modale en place : elles ne doivent ni disparaître ni changer de forme.
const LEGACY_KEYS = [
  "title", "stepAnalysis", "stepSummary", "analyzing", "analysisError", "retry", "retryTip",
  "noCompatible", "onlyOne", "preselected", "roleLabel", "candidate", "noneOption", "next", "nextTip",
  "back", "backTip", "summary", "confirm", "confirmTip", "confirming", "cancel", "cancelTip",
  "closeAria", "activatedToast", "reactivatedToast", "deactivatedToast", "undo", "error",
  "deactivateError", "cardAction", "cardActive", "cardUnavailableReason",
];

// Clés attendues par la modale étendue (maquette crm-activation-creation).
const REQUIRED_KEYS = [
  "org.label", "org.tip", "org.switching", "org.none",
  "space.label", "space.createOption", "space.disabledTip",
  "mode.connect", "mode.complete", "mode.create",
  "mode.connectTip", "mode.completeTip", "mode.createTip",
  "mode.connectUnavailable", "mode.completeUnavailable", "mode.createUnavailable", "mode.allTaken",
  "tile.chosenBase", "tile.score", "tile.columnsAdded", "tile.relations", "tile.collision", "tile.noCandidate", "tile.adopt", "tile.adoptTip", "tile.collisionBlocked",
  "status.compatible", "status.almost", "status.none",
  "recap.title", "recap.columnsAdded", "recap.beside", "recap.relationsCreated", "recap.unlinkedRelation",
  "progress.aria", "progress.running", "progress.createSpace", "progress.createDatabases",
  "progress.addColumns", "progress.createRelations", "progress.connectRoles",
  "toast.activated", "toast.activatedCompleted", "toast.reactivated", "toast.undone", "toast.undoTip",
  "errors.notFound", "errors.forbidden", "errors.nameCollision", "errors.quota", "errors.generic", "errors.retry",
  "confirmMissingTip", "confirmInvalidTip",
  "tile.candidateSubTaken", "tile.untouchedNeverConverted", "recap.besideLine",
];

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
  const json = JSON.parse(readFileSync(file, "utf8")) as { crm?: { activation?: unknown } };
  if (!json.crm?.activation || typeof json.crm.activation !== "object") {
    throw new Error(`${locale}.json: namespace crm.activation absent`);
  }
  return flatten(json.crm.activation);
}

// Arguments ICU : {name} comme {count, plural, ...} (même heuristique que scripts/i18n-check.mjs).
function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]))].sort();
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Record<string, string>>;
const reference = Object.keys(messages.fr).sort();

describe("libellés de la modale d'activation CRM", () => {
  it("les 7 fichiers contiennent exactement les mêmes clés crm.activation.*", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(reference);
    }
  });

  it("les clés de la modale en place sont conservées", () => {
    for (const key of LEGACY_KEYS) expect(reference, key).toContain(key);
  });

  it("les clés attendues par la modale étendue existent en français", () => {
    for (const key of REQUIRED_KEYS) expect(reference, key).toContain(key);
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
        expect(/[–—]/.test(value), `${locale}.${key}`).toBe(false);
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

  it("aucune apostrophe ne précède une accolade, un chevron ou un dièse (échappement ICU)", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(/'[{}<>#]/.test(value), `${locale}.${key}`).toBe(false);
      }
    }
  });

  it("les erreurs 404 et 403 ne nomment aucune ressource", () => {
    for (const locale of LOCALES) {
      for (const key of ["errors.notFound", "errors.forbidden"]) {
        expect(placeholders(messages[locale][key]), `${locale}.${key}`).toEqual([]);
      }
    }
  });

  it("le message de collision porte le nom de la base", () => {
    expect(placeholders(messages.fr["tile.collision"])).toContain("name");
  });

  it("les lignes assemblées ont leur clé complète avec placeholders", () => {
    expect(placeholders(messages.fr["recap.besideLine"])).toEqual(["column", "name", "type"]);
    expect(placeholders(messages.fr["tile.candidateSubTaken"])).toEqual(["role", "space"]);
    expect(placeholders(messages.fr["tile.untouchedNeverConverted"])).toEqual([]);
  });
});
