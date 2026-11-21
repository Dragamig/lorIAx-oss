/**
 * Parité des clés `presentations.templates` entre les 7 locales (T7, modèles
 * de présentation).
 *
 * Le test de parité générique n'existe pas dans le dépôt : celui-ci porte donc
 * uniquement le sous-arbre `templates`. Il vérifie :
 * - que les 7 fichiers exposent exactement le même jeu de clés ;
 * - que les 4 modèles livrés ont leur nom et leur description ;
 * - que les placeholders ICU (`{name}`, `{count}`...) sont identiques à ceux
 *   du français dans chaque traduction ;
 * - qu'aucun tiret cadratin ni demi-cadratin n'apparaît dans les valeurs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "es", "de", "br", "ja", "zh"] as const;
const MESSAGES_DIR = path.resolve(__dirname, "../../../messages");
const SEED_KEYS = ["pitch", "meeting-notes", "training", "status-update"] as const;
/** Clés dont la valeur est un nom propre ou la marque, identiques dans toutes les langues. */
const BRAND_KEYS = new Set(["badgeLorIAx", "filterLorIAx"]);
/** Mots identiques à l'anglais dans une langue donnée (cognats légitimes). */
const COGNATE_KEYS: Partial<Record<(typeof LOCALES)[number], Set<string>>> = {
  fr: new Set(["descriptionLabel"]),
};

type Tree = { [key: string]: string | Tree };

function loadTemplates(locale: string): Tree {
  const raw = JSON.parse(
    readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf-8"),
  ) as { presentations?: { templates?: Tree } };
  const templates = raw.presentations?.templates;
  if (!templates) {
    throw new Error(`${locale}.json : presentations.templates absent`);
  }
  return templates;
}

/** Aplatit l'arbre en chemins pointés, feuilles uniquement. */
function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[full] = value;
    } else {
      Object.assign(out, flatten(value, full));
    }
  }
  return out;
}

function placeholders(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([a-zA-Z_][\w]*)\s*[,}]/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

const flat = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(loadTemplates(locale))]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;

const frenchKeys = Object.keys(flat.fr).sort();

describe("presentations.templates : parité des 7 locales", () => {
  it.each(LOCALES)("%s expose exactement les clés du français", (locale) => {
    expect(Object.keys(flat[locale]).sort()).toEqual(frenchKeys);
  });

  it("le français porte un sous-arbre non vide", () => {
    expect(frenchKeys.length).toBeGreaterThan(0);
  });

  it.each(SEED_KEYS)(
    "le modèle livré « %s » a un nom et une description dans chaque locale",
    (seedKey) => {
      for (const locale of LOCALES) {
        expect(flat[locale][`lorIAx.${seedKey}.name`], locale).toBeTruthy();
        expect(flat[locale][`lorIAx.${seedKey}.description`], locale).toBeTruthy();
      }
    },
  );

  it.each(frenchKeys)("« %s » garde les mêmes placeholders ICU que le français", (key) => {
    const expected = placeholders(flat.fr[key]);
    for (const locale of LOCALES) {
      expect(placeholders(flat[locale][key]), `${locale} ${key}`).toEqual(expected);
    }
  });

  it("aucune valeur ne contient de tiret cadratin ni demi-cadratin", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(flat[locale])) {
        expect(value, `${locale} ${key}`).not.toMatch(/[–—]/);
      }
    }
  });

  it("chaque pluriel ICU a une branche other", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(flat[locale])) {
        if (/,\s*plural\s*,/.test(value)) {
          expect(value, `${locale} ${key}`).toMatch(/\bother\s*\{/);
        }
      }
    }
  });

  it("aucune traduction n'est identique à l'anglais, hors noms propres et marque", () => {
    for (const locale of LOCALES) {
      if (locale === "en") continue;
      for (const [key, value] of Object.entries(flat[locale])) {
        if (BRAND_KEYS.has(key) || COGNATE_KEYS[locale]?.has(key)) continue;
        expect(value, `${locale} ${key}`).not.toBe(flat.en[key]);
      }
    }
  });
});

describe("bouton « Retour à la liste » : info-bulle dans les 7 locales", () => {
  it.each(LOCALES)("%s expose presentations.backToListTip non vide", (locale) => {
    const raw = JSON.parse(
      readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf-8"),
    ) as { presentations?: { backToListTip?: string } };
    expect(raw.presentations?.backToListTip, locale).toBeTruthy();
  });
});
