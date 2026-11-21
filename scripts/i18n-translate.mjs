#!/usr/bin/env node
/**
 * Liste les clés présentes dans fr.json (référence) mais manquantes ou vides
 * dans les autres locales, et les émet en batchs JSON prêts à traduire.
 *
 * La liste des locales est dérivée du contenu de messages/ (pas de hardcode).
 * La sortie est un tableau JSON de batchs :
 *   [{ "locale": "de", "batch": 1, "keys": { "common.save": "Enregistrer", … } }, …]
 *
 * Usage :
 *   node scripts/i18n-translate.mjs                 # toutes les locales ≠ fr
 *   node scripts/i18n-translate.mjs --locale=de     # une seule locale
 *   node scripts/i18n-translate.mjs --batch-size=20 # taille de batch (défaut 50)
 */
import { readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = resolve(__dirname, "../messages");
const REFERENCE = "fr";

const args = process.argv.slice(2);
const localeArg = args.find((a) => a.startsWith("--locale="))?.split("=")[1];
const batchSizeArg = args.find((a) => a.startsWith("--batch-size="))?.split("=")[1];
const BATCH_SIZE = Number(batchSizeArg) > 0 ? Number(batchSizeArg) : 50;

const allLocales = readdirSync(messagesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const targets = allLocales.filter((l) => l !== REFERENCE && (!localeArg || l === localeArg));

if (localeArg && targets.length === 0) {
  if (localeArg === REFERENCE) {
    console.error(`❌ ${REFERENCE} est la locale de référence, pas une cible de traduction`);
  } else {
    const available = allLocales.filter((l) => l !== REFERENCE);
    console.error(`❌ Locale inconnue : ${localeArg} (disponibles : ${available.join(", ")})`);
  }
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

const reference = flatten(loadJson(REFERENCE));
const batches = [];

for (const locale of targets) {
  const flat = flatten(loadJson(locale));
  const todo = [...reference].filter(([key]) => {
    const value = flat.get(key);
    return value === undefined || (typeof value === "string" && value.trim() === "");
  });

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    batches.push({
      locale,
      batch: Math.floor(i / BATCH_SIZE) + 1,
      keys: Object.fromEntries(todo.slice(i, i + BATCH_SIZE)),
    });
  }

  console.error(
    todo.length === 0
      ? `✓ ${locale.toUpperCase()} — rien à traduire`
      : `  ${locale.toUpperCase()} — ${todo.length} clé(s) à traduire`,
  );
}

console.log(JSON.stringify(batches, null, 2));
