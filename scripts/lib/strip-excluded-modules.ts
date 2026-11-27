/**
 * Retire des sources conservées les descripteurs des modules exclus d'un profil
 * (manifestes du registre, commandes slash et extensions
 * optionnelles gardées par un identifiant de module). Transformations textuelles pures,
 * appliquées après l'élagage des fichiers : l'arbre exporté ne décrit plus ce qu'il ne contient pas.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REGISTRY_FILE = "src/lib/modules/registry.ts";
export const SLASH_COMMANDS_FILE = "src/components/editor/extensions/slash-commands/commands.tsx";
export const OPTIONAL_EXTENSIONS_FILE = "src/components/editor/extensions/optional-extensions.config.ts";

/** Modules dont les sources gardées portent forcément des descripteurs : un retrait sans résultat est une erreur. */
export const EXPECTED_SLASH_MODULES = ["studiovideo"];
export const EXPECTED_OPTIONAL_MODULES = ["studiovideo"];

export class StripError extends Error {
  constructor(message: string) {
    super(`strip-excluded-modules : ${message}`);
    this.name = "StripError";
  }
}

/** Retire les objets `{ id: "<id>", ... },` (indentation 2) ; chaque identifiant doit être trouvé et son bloc refermé. */
export function stripRegistryManifests(source: string, ids: string[]): string {
  const lines = source.split("\n");
  const out: string[] = [];
  const found = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i] === "  {" ? /^ {4}id: "([^"]+)",$/.exec(lines[i + 1] ?? "") : null;
    if (m && ids.includes(m[1])) {
      let end = i + 1;
      while (end < lines.length && lines[end] !== "  },") end++;
      if (end >= lines.length) throw new StripError(`bloc du manifeste "${m[1]}" non refermé dans le registre`);
      found.add(m[1]);
      i = end;
      continue;
    }
    out.push(lines[i]);
  }
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new StripError(`manifeste(s) introuvable(s) dans le registre : ${missing.join(", ")}`);
  return out.join("\n");
}

/** Retire les entrées de commande slash portant `module: "<id>"` et leurs alias de recherche. */
export function stripSlashCommands(source: string, ids: string[]): string {
  const lines = source.split("\n");
  const out: string[] = [];
  const titles: string[] = [];
  const found = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const title = /^ {4}title: "([^"]+)",$/.exec(lines[i + 1] ?? "");
    const mod = /^ {4}module: "([^"]+)",$/.exec(lines[i + 2] ?? "");
    if (lines[i] === "  {" && title && mod && ids.includes(mod[1])) {
      titles.push(title[1]);
      found.add(mod[1]);
      const start = i;
      while (i < lines.length && lines[i] !== "  },") i++;
      if (i >= lines.length) throw new StripError(`commande slash "${title[1]}" (ligne ${start + 1}) non refermée`);
      continue;
    }
    out.push(lines[i]);
  }
  const missing = EXPECTED_SLASH_MODULES.filter((id) => ids.includes(id) && !found.has(id));
  if (missing.length > 0) throw new StripError(`aucune commande slash trouvée pour : ${missing.join(", ")}`);
  let result = out.join("\n");
  for (const t of titles) {
    result = result
      .split("\n")
      .filter((l) => !l.startsWith(`  "${t}": [`))
      .join("\n");
  }
  // Import d'icône devenu inutilisé : s'il en reste, l'échec est signalé.
  for (const name of ["Clapperboard"]) {
    const uses = result.split(new RegExp(`\\b${name}\\b`)).length - 1;
    const importLine = new RegExp(`^ {2}${name},\\n`, "m");
    if (uses === 1) {
      if (!importLine.test(result)) throw new StripError(`import d'icône ${name} non retiré`);
      result = result.replace(importLine, "");
    }
  }
  return result;
}

/** Retire les lignes d'extensions optionnelles rattachées à un module exclu. */
export function stripOptionalExtensions(source: string, ids: string[]): string {
  const found = new Set<string>();
  const out = source.split("\n").filter((l) => {
    const m = /moduleId: "([^"]+)"/.exec(l);
    if (m && ids.includes(m[1])) {
      found.add(m[1]);
      return false;
    }
    return true;
  });
  const missing = EXPECTED_OPTIONAL_MODULES.filter((id) => ids.includes(id) && !found.has(id));
  if (missing.length > 0) throw new StripError(`aucune extension optionnelle trouvée pour : ${missing.join(", ")}`);
  return out.join("\n");
}

/** Supprime les clés (notation pointée) d'un objet de messages ; vrai si au moins une a été retirée. */
export function deleteMessageKeys(messages: Record<string, unknown>, keys: string[]): boolean {
  let removed = false;
  for (const key of keys) {
    const path = key.split(".");
    let node: unknown = messages;
    for (const part of path.slice(0, -1)) {
      node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
    }
    const last = path[path.length - 1];
    if (node && typeof node === "object" && last in (node as object)) {
      delete (node as Record<string, unknown>)[last];
      removed = true;
    }
  }
  return removed;
}

/** Retire les clés de messages des modules exclus dans chaque messages/<locale>.json. */
export function stripMessageKeys(root: string, keys: string[]): string[] {
  const dir = join(root, "messages");
  if (keys.length === 0 || !existsSync(dir)) return [];
  const changed: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const abs = join(dir, f);
    const messages = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
    if (deleteMessageKeys(messages, keys)) {
      writeFileSync(abs, JSON.stringify(messages, null, 2) + "\n");
      changed.push(`messages/${f}`);
    }
  }
  return changed;
}

/** Applique les retraits sur un dossier d'application ; renvoie les fichiers réécrits. */
export function stripExcludedModules(root: string, ids: string[], messageKeys: string[] = []): string[] {
  if (ids.length === 0) return [];
  const steps: Array<[string, (s: string, ids: string[]) => string]> = [
    [REGISTRY_FILE, stripRegistryManifests],
    [SLASH_COMMANDS_FILE, stripSlashCommands],
    [OPTIONAL_EXTENSIONS_FILE, stripOptionalExtensions],
  ];
  const changed: string[] = [];
  for (const [file, fn] of steps) {
    const abs = join(root, file);
    if (!existsSync(abs)) throw new StripError(`fichier attendu absent : ${file}`);
    const before = readFileSync(abs, "utf8");
    const after = fn(before, ids);
    if (after !== before) {
      writeFileSync(abs, after);
      changed.push(file);
    }
  }
  changed.push(...stripMessageKeys(root, messageKeys));
  return changed;
}

const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Vérification postérieure : l'arbre élagué ne mentionne plus aucun module exclu ni clé possédée
 * (registre, extensions optionnelles, commandes slash, messages). Renvoie la liste des reliquats.
 */
export function findExcludedLeftovers(root: string, ids: string[], messageKeys: string[] = []): string[] {
  const problems: string[] = [];
  const idAlt = ids.map(escapeRe).join("|");
  const checks: Array<[string, RegExp]> = [
    [REGISTRY_FILE, new RegExp(`^ {4}id: "(${idAlt})",$`)],
    [SLASH_COMMANDS_FILE, new RegExp(`^\\s*module: "(${idAlt})",?$`)],
    [OPTIONAL_EXTENSIONS_FILE, new RegExp(`moduleId: "(${idAlt})"`)],
  ];
  if (ids.length > 0) {
    for (const [file, re] of checks) {
      const abs = join(root, file);
      if (!existsSync(abs)) {
        problems.push(`${file} : fichier absent`);
        continue;
      }
      readFileSync(abs, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (re.test(l)) problems.push(`${file}:${i + 1} mentionne encore un module exclu : ${l.trim()}`);
        });
    }
  }
  const dir = join(root, "messages");
  if (messageKeys.length > 0 && existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
      const messages = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>;
      for (const key of messageKeys) {
        if (deleteMessageKeys(messages, [key])) problems.push(`messages/${f} contient encore la clé ${key}`);
      }
    }
  }
  return problems;
}
