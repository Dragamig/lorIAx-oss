#!/usr/bin/env node
/**
 * Vérifie la cohérence des fichiers messages/<locale>.json :
 *   1. parité des clés entre fr.json (référence) et chaque autre locale
 *      (clés manquantes ET clés orphelines = erreurs) ;
 *   2. parité des placeholders ICU ({name}, {count}, …) clé par clé ;
 *   3. aucune valeur vide ("").
 *
 * La liste des locales est dérivée du contenu de messages/ (pas de hardcode).
 * Exit 1 si au moins une erreur, avec un diff lisible par locale.
 *
 * Usage : node scripts/i18n-check.mjs
 */
import { readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = resolve(__dirname, "../messages");
const REFERENCE = "fr";

const locales = readdirSync(messagesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

if (!locales.includes(REFERENCE)) {
  console.error(`❌ Locale de référence absente : messages/${REFERENCE}.json`);
  process.exit(1);
}

function loadJson(locale) {
  return JSON.parse(readFileSync(resolve(messagesDir, `${locale}.json`), "utf-8"));
}

function flatten(obj, prefix = "") {
  const out = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) {
      for (const [ck, cv] of flatten(v, key)) out.set(ck, cv);
    } else {
      out.set(key, v);
    }
  }
  return out;
}

/**
 * Extrait les noms d'arguments ICU d'un message.
 * Heuristique : tout identifiant suivant directement une accolade ouvrante
 * ({name}, {count, plural, …}). Les sous-messages « {# items} » commencent
 * par « # » et ne sont donc pas capturés.
 */
function icuArgs(value) {
  if (typeof value !== "string") return new Set();
  const args = new Set();
  for (const m of value.matchAll(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    args.add(m[1]);
  }
  return args;
}

const reference = flatten(loadJson(REFERENCE));
let errors = 0;

for (const locale of locales) {
  const flat = locale === REFERENCE ? reference : flatten(loadJson(locale));
  const localeErrors = [];

  if (locale !== REFERENCE) {
    for (const key of reference.keys()) {
      if (!flat.has(key)) localeErrors.push(`clé manquante : ${key}`);
    }
    for (const key of flat.keys()) {
      if (!reference.has(key)) localeErrors.push(`clé orpheline (absente de fr) : ${key}`);
    }
    for (const [key, value] of flat) {
      if (!reference.has(key)) continue;
      const refArgs = icuArgs(reference.get(key));
      const locArgs = icuArgs(value);
      const missing = [...refArgs].filter((a) => !locArgs.has(a));
      const extra = [...locArgs].filter((a) => !refArgs.has(a));
      if (missing.length || extra.length) {
        localeErrors.push(
          `placeholders ICU divergents : ${key}` +
            (missing.length ? ` — manquants {${missing.join("}, {")}}` : "") +
            (extra.length ? ` — en trop {${extra.join("}, {")}}` : ""),
        );
      }
    }
  }

  for (const [key, value] of flat) {
    if (typeof value === "string" && value.trim() === "") {
      localeErrors.push(`valeur vide : ${key}`);
    }
  }

  if (localeErrors.length > 0) {
    console.error(`\n❌ ${locale.toUpperCase()} — ${localeErrors.length} erreur(s) :`);
    for (const e of localeErrors) console.error(`   ${e}`);
    errors += localeErrors.length;
  }
}

if (errors > 0) {
  console.error(
    `\n${errors} erreur(s) au total. Compléter via i18n:translate ou manuellement.`,
  );
  process.exit(1);
}

console.log(
  `✓ Parité OK — ${reference.size} clés × ${locales.length} locales (${locales.join(", ")})`,
);
