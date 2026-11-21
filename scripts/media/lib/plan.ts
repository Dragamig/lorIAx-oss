/**
 * Cadre commun des scripts de réécriture : options, sauvegarde, résolution.
 * Aucune connexion base ici. Simulation par défaut, écriture seulement avec --apply.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RewriteMode {
  apply: boolean;
  limit?: number;
  org?: string;
  reportPath: string;
  /** Nom de la base que l'opérateur déclare viser ; exigé en --apply. */
  confirmDb?: string;
}

export const DEFAULT_REPORT_PATH = "tmp/media-rewrite/report.json";

export function parseMode(argv: string[]): RewriteMode {
  const mode: RewriteMode = { apply: false, reportPath: DEFAULT_REPORT_PATH };
  let sawApply = false;
  let sawDryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "" || v.startsWith("--")) throw new Error(`Usage : ${flag} demande une valeur`);
      return v;
    };
    switch (flag) {
      case "--apply":
        if (inline !== undefined) throw new Error("Usage : --apply n'accepte pas de valeur");
        sawApply = true;
        mode.apply = true;
        break;
      case "--dry-run":
        if (inline !== undefined) throw new Error("Usage : --dry-run n'accepte pas de valeur");
        sawDryRun = true;
        mode.apply = false;
        break;
      case "--confirm-db":
        mode.confirmDb = value();
        break;
      case "--limit": {
        const n = Number(value());
        if (!Number.isInteger(n) || n <= 0) throw new Error("Usage : --limit demande un entier positif");
        mode.limit = n;
        break;
      }
      case "--org":
        mode.org = value();
        break;
      case "--report":
        mode.reportPath = value();
        break;
      default:
        throw new Error(`Usage : option inconnue ${arg}`);
    }
  }
  if (sawApply && sawDryRun) throw new Error("Usage : --apply et --dry-run sont exclusifs");
  return mode;
}

/** Exige une DATABASE_URL explicite : aucune base par défaut, jamais celle de production par accident. */
export function requireDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL explicite requise : aucune base par défaut.");
  return url;
}

/** Nom de la base (dernier segment du chemin, sans paramètres). */
export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, "").split("/")[0] ?? "");
  } catch {
    return "";
  }
}

/**
 * Garde-fou sur la base visée. En --apply, --confirm-db doit être égal au nom de la
 * base. Une base nommée exactement `loriax` est toujours refusée, sauf --confirm-db=loriax.
 * En simulation, la cible est seulement affichée par l'appelant.
 */
export function assertTargetAllowed(url: string, mode: Pick<RewriteMode, "apply" | "confirmDb">): void {
  const name = databaseName(url);
  if (!name) throw new Error("Base cible illisible dans DATABASE_URL.");
  if (name === "loriax" && mode.confirmDb !== "loriax") {
    throw new Error('Base "loriax" refusée : passer --confirm-db=loriax pour la viser explicitement.');
  }
  if (mode.apply && mode.confirmDb !== name) {
    throw new Error(`--apply exige --confirm-db=${name} (nom exact de la base cible).`);
  }
}

/** Description de la base cible sans le mot de passe, à afficher avant tout travail. */
export function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(URL de base illisible)";
  }
}

/** Écrit la sauvegarde des valeurs d'origine ; à appeler avant toute écriture. Retourne le chemin. */
export function writeBackup(
  dir: string,
  name: string,
  entries: Array<{ id: string; before: unknown }>
): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${name}-${stamp}.json`);
  writeFileSync(path, JSON.stringify({ name, createdAt: new Date().toISOString(), entries }, null, 2), "utf8");
  return path;
}

export interface MediaLite {
  id: string;
  storageKey: string;
  organizationId?: string | null;
  spaceId?: string | null;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export type LookupResult =
  | { status: "found"; media: MediaLite }
  | { status: "not_found" }
  | { status: "ambiguous" };

export function resolveByStorageKey(key: string, candidates: MediaLite[]): LookupResult {
  const matches = candidates.filter((m) => m.storageKey === key);
  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "found", media: matches[0] };
}
