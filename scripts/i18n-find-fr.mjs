#!/usr/bin/env node
/**
 * Détecte les chaînes françaises restantes dans le code source.
 * Heuristique : texte contenant un accent (é è à ê ù â î ô û ï ë ç œ æ)
 * dans du JSX text ou un string literal.
 *
 * Ignore les lignes marquées // i18n-ignore
 * Usage : node scripts/i18n-find-fr.mjs [chemins…] [--json]
 *
 * Exemples :
 *   node scripts/i18n-find-fr.mjs                       # scanne src/
 *   node scripts/i18n-find-fr.mjs src/components src/lib
 *   node scripts/i18n-find-fr.mjs src/hooks --json
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve, extname, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const targetArgs = args.filter((a) => !a.startsWith("--"));
const TARGETS = (targetArgs.length > 0 ? targetArgs : ["src"]).map((t) => resolve(ROOT, t));

const ACCENT_RE = /[éèàêùâîôûïëçœæÉÈÀÊÙÂÎÔÛÏËÇŒÆ]/;
// Exclure imports, commentaires de code, URLs, keys i18n
const SKIP_LINE_RE = /^\s*(import |\/\/|\/\*|\*|export (const|type|interface|default)|#)/;
// Extensions à scanner
const EXT = new Set([".tsx", ".ts", ".jsx", ".js"]);

const results = [];

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = resolve(dir, e);
    const stat = statSync(p);
    if (stat.isDirectory() && !["node_modules", ".next", "dist"].includes(e)) {
      walk(p);
    } else if (stat.isFile() && EXT.has(extname(e))) {
      scan(p);
    }
  }
}

function scan(filePath) {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const rel = relative(ROOT, filePath);
  // Ignore les fichiers de messages
  if (rel.startsWith("messages/")) return;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ACCENT_RE.test(line)) continue;
    if (SKIP_LINE_RE.test(line)) continue;
    if (line.includes("i18n-ignore")) continue;
    results.push({ file: rel, line: i + 1, text: line.trim() });
  }
}

for (const target of TARGETS) {
  const stat = statSync(target);
  if (stat.isDirectory()) walk(target);
  else if (stat.isFile() && EXT.has(extname(target))) scan(target);
}

const targetLabels = TARGETS.map((t) => relative(ROOT, t)).join(", ");

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  if (results.length === 0) {
    console.log("✓ Aucune chaîne FR détectée dans", targetLabels);
    process.exit(0);
  }
  console.log(`⚠  ${results.length} chaîne(s) FR potentielle(s) dans ${targetLabels} :\n`);
  for (const r of results) {
    console.log(`  ${r.file}:${r.line}  ${r.text.slice(0, 120)}`);
  }
  process.exit(1);
}
