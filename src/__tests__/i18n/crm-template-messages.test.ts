import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRM_ROLES } from "@/lib/crm/fields";
import { loadTemplateMessages } from "@/lib/crm/template-messages";

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
  const json = JSON.parse(readFileSync(file, "utf8")) as { crm?: { template?: unknown } };
  if (!json.crm?.template) throw new Error(`${locale}.json: crm.template absent`);
  return flatten(json.crm.template);
}

const placeholders = (v: string) => [...new Set([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Record<string, string>>;
const reference = Object.keys(messages.fr).sort();

describe("messages crm.template.*", () => {
  it("chaque locale fournit crm.template.* avec les mêmes clés et les mêmes placeholders ; fr de référence ; aucune valeur vide ; aucun tiret cadratin ni demi-cadratin", () => {
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(reference);
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(/[—–]/.test(value), `${locale}.${key}`).toBe(false);
        expect(placeholders(value), `${locale}.${key}`).toEqual(placeholders(messages.fr[key]));
      }
    }
  });

  it("loadTemplateMessages rend 9 statuts, 4 types et un nom de base par rôle dans chaque locale", async () => {
    for (const locale of LOCALES) {
      const m = await loadTemplateMessages(locale);
      expect(m.statusOptions, locale).toHaveLength(9);
      expect(m.typeOptions, locale).toHaveLength(4);
      for (const role of CRM_ROLES) expect(m.databases[role].length, `${locale}.${role}`).toBeGreaterThan(0);
    }
  });

  it("loadTemplateMessages rend les 5 noms de vues, distincts, dans chaque locale", async () => {
    for (const locale of LOCALES) {
      const names = Object.values((await loadTemplateMessages(locale)).views);
      expect(names, locale).toHaveLength(5);
      expect(new Set(names.map((n) => n.toLowerCase())).size, locale).toBe(5);
    }
  });

  it("locale inconnue : repli fr", async () => {
    const fr = await loadTemplateMessages("fr");
    expect(await loadTemplateMessages("xx")).toEqual(fr);
    expect(fr.statusOptions[0]).toBe("Nouvelle");
  });
});
