import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRM_FIELDS, CRM_ROLES } from "@/lib/crm/fields";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;
const COLUMN_TYPES = [
  "text", "number", "date", "select", "checkbox", "relation", "image", "formula", "url",
  "email", "attachment", "time", "autonumber", "person", "document_link",
];
const ROUTE_ERROR_KEYS = [
  "invalidBody", "invalidRole", "columnNotInDatabase", "duplicateDatabase", "notFound",
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
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (!json.crm || typeof json.crm !== "object") throw new Error(`${locale}.json: namespace crm absent`);
  return flatten(json.crm);
}

function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Record<string, string>>;
const reference = Object.keys(messages.fr).sort();

describe("libellés du module CRM", () => {
  it("les 7 fichiers contiennent exactement les mêmes clés crm.*", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(reference);
    }
  });

  it("les clés attendues par les écrans existent en français", () => {
    const required = [
      "nav.crm", "nav.raccordement", "nav.notConnected", "title", "subtitle", "section.roles",
      "enabled.label", "states.ok", "states.bad", "states.none", "tile.fieldsCount",
      "tile.dissociateDisabled", "map.title", "alert.incomplete", "empty.noneConnectedTitle",
      "error.retry", "loading", "disabled.title", "disabled.enable", "disabled.nonAdmin",
      "activation.cardAction", "activation.cardActive", "activation.cardUnavailableReason",
      "activation.deactivatedToast", "toasts.roleChosen", "toasts.undone", "errors.columnMissing",
      ...ROUTE_ERROR_KEYS.map((k) => `errors.${k}`),
      ...COLUMN_TYPES.map((t) => `types.${t}`),
      ...CRM_ROLES.flatMap((r) => [`roles.${r}.label`, `roles.${r}.description`]),
      ...CRM_ROLES.flatMap((r) => CRM_FIELDS[r].map((f) => `fields.${r}.${f.key}`)),
    ];
    for (const key of required) expect(reference, key).toContain(key);
  });

  it("les libellés contact et sens des Interactions existent dans les 7 langues", () => {
    for (const locale of LOCALES) {
      for (const k of ["fields.interactions.contact", "fields.interactions.sens"]) {
        expect(messages[locale][k], `${locale}.${k}`).toBeTruthy();
      }
    }
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
