/**
 * Supprime physiquement les fichiers possédés UNIQUEMENT par des modules exclus
 * (ref-count via ownedPaths). Opère sur l'arbre courant — à n'exécuter que dans
 * un contexte de build jetable (build-client.sh restaure l'arbre ensuite).
 *
 * Usage : npx tsx scripts/prune-modules.ts --profile clients/<client>.json [--root <dir>]
 * `--root` opère sur un autre dossier d'application (défaut : le dossier de ce script).
 */
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getAllModuleManifests } from "../src/lib/modules/registry";
import { parseClientProfile, resolveIncludedModules, type ClientProfile } from "../src/lib/modules/composition";
import { shouldPrune } from "../src/lib/modules/owned-paths";

const DEFAULT_ROOT = resolve(__dirname, "..");

/** Dossier d'application visé : `--root <dir>` ou, à défaut, celui qui contient ce script. */
export function rootFromArgs(args: string[]): string {
  const i = args.indexOf("--root");
  if (i === -1) return DEFAULT_ROOT;
  if (!args[i + 1]) throw new Error("Usage: --root <dossier>");
  return resolve(args[i + 1]);
}

/** Fichiers suivis à supprimer pour ce profil (calcul pur, sans effet de bord). */
export function computePrunable(profile: ClientProfile, tracked: string[]): string[] {
  const included = resolveIncludedModules(profile);

  // Tous les manifestes (pas seulement les inclus) : il faut connaître les
  // ownedPaths des modules EXCLUS pour savoir quoi supprimer. `included` (issu
  // du profil) tranche ensuite inclus/exclu indépendamment de registry.generated.
  const includedPatterns: string[] = [];
  const excludedPatterns: string[] = [];
  for (const m of getAllModuleManifests()) {
    const target = included.has(m.id) ? includedPatterns : excludedPatterns;
    target.push(...(m.ownedPaths ?? []));
  }
  return tracked.filter((p) => shouldPrune(p, includedPatterns, excludedPatterns));
}

function main() {
  const args = process.argv.slice(2);
  const ROOT = rootFromArgs(args);
  const pIdx = args.indexOf("--profile");
  if (pIdx === -1 || !args[pIdx + 1]) throw new Error("Usage: --profile <chemin.json>");
  const profile = parseClientProfile(JSON.parse(readFileSync(resolve(ROOT, args[pIdx + 1]), "utf8")));

  // Tout loriax-app : les ownedPaths peuvent viser assets/, scripts/, docs/.
  const tracked = execSync("git ls-files", { cwd: ROOT }).toString().split("\n").filter(Boolean);
  const toPrune = computePrunable(profile, tracked);

  for (const p of toPrune) rmSync(resolve(ROOT, p), { force: true });
  console.log(`✓ prune : ${toPrune.length} fichier(s) supprimé(s) pour le profil ${profile.client}`);
  for (const p of toPrune) console.log(`  - ${p}`);
}

if (resolve(process.argv[1] ?? "") === resolve(__filename)) main();
