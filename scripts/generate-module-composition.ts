/**
 * Génère src/lib/modules/registry.generated.ts (allowlist d'ids) et
 * src/components/editor/extensions/optional.generated.ts (barrel des extensions incluses).
 *
 * Usage :
 *   npx tsx scripts/generate-module-composition.ts --all
 *   npx tsx scripts/generate-module-composition.ts --profile clients/<client>.json [--root <dir>]
 * `--root` opère sur un autre dossier d'application (défaut : le dossier de ce script).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllModuleManifests } from "../src/lib/modules/registry";
import { parseClientProfile, resolveIncludedModules } from "../src/lib/modules/composition";
import { OPTIONAL_EXTENSION_SOURCES } from "../src/components/editor/extensions/optional-extensions.config";
import type { ModuleId, ModuleManifest } from "../src/lib/modules/types";

const DEFAULT_ROOT = resolve(__dirname, "..");

/** Dossier d'application visé : `--root <dir>` ou, à défaut, celui qui contient ce script. */
export function rootFromArgs(args: string[]): string {
  const i = args.indexOf("--root");
  if (i === -1) return DEFAULT_ROOT;
  if (!args[i + 1]) throw new Error("Usage: --root <dossier>");
  return resolve(args[i + 1]);
}

/**
 * Résout la composition depuis le registre STATIQUE complet, jamais depuis
 * registry.generated : la sortie d'un run précédent (profil oss, exemple) ne doit pas
 * borner le suivant, sinon `--all` ne peut pas restaurer les modules retirés.
 */
export function includedIds(args: string[] = process.argv.slice(2)): ModuleId[] {
  const all = getAllModuleManifests().map((m) => m.id);
  if (args.includes("--all")) return all;
  const pIdx = args.indexOf("--profile");
  if (pIdx === -1 || !args[pIdx + 1]) {
    throw new Error("Usage: --all | --profile <chemin.json>");
  }
  const profile = parseClientProfile(JSON.parse(readFileSync(resolve(rootFromArgs(args), args[pIdx + 1]), "utf8")));
  const set = resolveIncludedModules(profile);
  // Conserver l'ordre canonique du registre.
  return all.filter((id) => set.has(id));
}

function writeRegistry(ROOT: string, ids: ModuleId[]) {
  const lines = ids.map((id) => `  "${id}",`).join("\n");
  const content = `// AUTO-GÉNÉRÉ par scripts/generate-module-composition.ts — NE PAS ÉDITER À LA MAIN.
import type { ModuleId } from "./types";

export const INCLUDED_MODULE_IDS: ModuleId[] = [
${lines}
];
`;
  writeFileSync(resolve(ROOT, "src/lib/modules/registry.generated.ts"), content);
}

function writeBarrel(ROOT: string, ids: Set<ModuleId>) {
  const sources = OPTIONAL_EXTENSION_SOURCES.filter((s) => ids.has(s.moduleId));
  const imports = sources
    .map((s) => `import { ${s.exportName} } from "${s.importPath}";`)
    .join("\n");
  const entries = sources.map((s) => `  ${s.key}: ${s.exportName},`).join("\n");
  const content = `// AUTO-GÉNÉRÉ par scripts/generate-module-composition.ts — NE PAS ÉDITER À LA MAIN.
import type { AnyExtension } from "@tiptap/core";
${imports}

export const OPTIONAL_EDITOR_EXTENSIONS: Record<string, AnyExtension> = {
${entries}
};
`;
  writeFileSync(
    resolve(ROOT, "src/components/editor/extensions/optional.generated.ts"),
    content
  );
}

export const HOOK_BARREL_FILES = {
  server: "hooks.server.generated.ts",
  client: "hooks.client.generated.ts",
  env: "hooks.env.generated.ts",
  http: "hooks.http.generated.ts",
} as const;

type HookKind = keyof typeof HOOK_BARREL_FILES;
const HEADER = "// AUTO-GÉNÉRÉ par scripts/generate-module-composition.ts, NE PAS ÉDITER À LA MAIN.";

/**
 * Rend les quatre barils de hooks. Chacun n'importe que les fichiers d'enregistrement
 * des modules inclus déclarant `hooks.<nature>`, dans l'ordre canonique du registre.
 * `env` et `http` sont des feuilles : leurs fichiers ne doivent importer ni la base,
 * ni la licence, ni le baril serveur.
 */
export function renderHookBarrels(
  manifests: Array<Pick<ModuleManifest, "id" | "hooks">>,
  included: Set<ModuleId>,
): Record<string, string> {
  const pick = (kind: HookKind) =>
    manifests
      .filter((m) => included.has(m.id) && m.hooks?.[kind])
      .map((m, i) => ({ alias: `register${i}`, path: m.hooks![kind]! }));
  const imports = (list: ReturnType<typeof pick>) =>
    list.map((e) => `import { register as ${e.alias} } from "${e.path}";`).join("\n");
  const join = (parts: string[]) => parts.filter(Boolean).join("\n") + "\n";

  const server = pick("server");
  const client = pick("client");
  const env = pick("env");
  const http = pick("http");

  return {
    [HOOK_BARREL_FILES.server]: join([
      HEADER,
      imports(server),
      "",
      `export function registerIncludedModuleHooks(): void {${server.length ? "\n" + server.map((e) => `  ${e.alias}();`).join("\n") + "\n" : ""}}`,
    ]),
    [HOOK_BARREL_FILES.client]: join([
      HEADER,
      imports(client),
      "",
      `export function registerIncludedModuleHooks(): void {${client.length ? "\n" + client.map((e) => `  ${e.alias}();`).join("\n") + "\n" : ""}}`,
    ]),
    [HOOK_BARREL_FILES.env]: join([
      HEADER,
      'import type { ZodRawShape } from "zod";',
      imports(env),
      "",
      `export function collectIncludedEnvShape(): ZodRawShape {\n  return {${env.map((e) => `\n    ...${e.alias}(),`).join("")}${env.length ? "\n  " : ""}};\n}`,
    ]),
    [HOOK_BARREL_FILES.http]: join([
      HEADER,
      'import type { HttpHooks } from "./hooks.http";',
      imports(http),
      "",
      `export function collectIncludedHttpHooks(): Partial<HttpHooks> {\n  return {${http.map((e) => `\n    ...${e.alias}(),`).join("")}${http.length ? "\n  " : ""}};\n}`,
    ]),
  };
}

function writeHookBarrels(ROOT: string, ids: Set<ModuleId>) {
  const files = renderHookBarrels(getAllModuleManifests(), ids);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(resolve(ROOT, "src/lib/modules", name), content);
  }
}

function main() {
  const root = rootFromArgs(process.argv.slice(2));
  const ids = includedIds();
  writeRegistry(root, ids);
  writeBarrel(root, new Set(ids));
  writeHookBarrels(root, new Set(ids));
  console.log(`✓ composition générée pour ${ids.length} modules : ${ids.join(", ")}`);
}

if (require.main === module) main();
