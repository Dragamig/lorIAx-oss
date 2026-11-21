import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";
import { getModuleManifest } from "./registry";
import type { ModuleId, ModuleManifest } from "./types";

export const TOGGLE_PREFIX = "module_enabled::";

/**
 * Normalise la valeur stockée en booléen, ou null si non interprétable.
 * Si `field` est fourni, lit ce sous-champ booléen dans la valeur JSON
 * (rétro-compat avec les réglages /admin/services qui portent aussi d'autres
 * clés de config dans le même objet).
 */
export function parseToggleValue(value: unknown, field?: string): boolean | null {
  if (field) {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && field in value) {
      return Boolean((value as Record<string, unknown>)[field]);
    }
    // Forme héritée : certaines clés ont été écrites en booléen nu, sans objet
    // de configuration autour (meeting_rooms_enabled par l'ancienne page
    // Services). La migration de normalisation existe mais n'est pas jouée
    // automatiquement au déploiement : sans cette tolérance, une instance non
    // migrée lirait « réglage absent » et éteindrait le module en silence.
    if (typeof value === "boolean") return value;
    return null;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "object" && value !== null && "enabled" in value) {
    return Boolean((value as { enabled: unknown }).enabled);
  }
  return null;
}

/** Clé de stockage du toggle d'un module (legacy si déclarée). */
export function resolveToggleKey(manifest: ModuleManifest): string {
  return manifest.toggleKey ?? `${TOGGLE_PREFIX}${manifest.id}`;
}

/** Lit les toggles de tous les manifestes fournis → map moduleId -> bool. */
export async function getModuleToggles(
  manifests: ModuleManifest[]
): Promise<Record<string, boolean>> {
  const keyToManifest = new Map(manifests.map((m) => [resolveToggleKey(m), m]));
  const keys = [...keyToManifest.keys()];
  if (keys.length === 0) return {};

  const rows = await db
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, keys));

  const out: Record<string, boolean> = {};
  for (const row of rows) {
    const manifest = keyToManifest.get(row.key);
    if (!manifest) continue;
    const parsed = parseToggleValue(row.value, manifest.toggleField);
    if (parsed !== null) out[manifest.id] = parsed;
  }
  return out;
}

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Construit l'upsert atomique du toggle. Une seule instruction SQL : le MERGE
 * se fait côté base (`||` sur l'objet existant), donc deux bascules
 * concurrentes de modules partageant une même clé ne s'écrasent pas. Une
 * valeur existante qui n'est pas un objet est remplacée par `{}` avant le
 * merge (même comportement que l'ancienne lecture puis écriture). Clé, champ
 * et booléen sont des paramètres liés, jamais interpolés.
 */
export function buildModuleToggleQuery(manifest: ModuleManifest, enabled: boolean) {
  const registered = getModuleManifest(manifest.id);
  if (!registered) {
    throw new Error(`Module inconnu : ${manifest.id}`);
  }
  const key = resolveToggleKey(registered);
  const field = registered.toggleField ?? "enabled";
  if (!FIELD_RE.test(field)) {
    throw new Error(`Champ de toggle invalide pour ${registered.id}`);
  }
  return sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${key}, jsonb_build_object(${field}::text, ${enabled}::boolean), now())
    ON CONFLICT (key) DO UPDATE SET
      value = (CASE WHEN jsonb_typeof(system_settings.value) = 'object'
                    THEN system_settings.value ELSE '{}'::jsonb END) || EXCLUDED.value,
      updated_at = now()
  `;
}

/**
 * Écrit (upsert) le toggle d'un module en MERGE atomique : ne modifie que le
 * sous-champ ciblé pour ne pas écraser la config voisine (URL, clés API, etc.)
 * stockée sous la même clé system_settings.
 */
export async function setModuleToggle(
  manifest: ModuleManifest,
  enabled: boolean
): Promise<void> {
  await db.execute(buildModuleToggleQuery(manifest, enabled));
}

export type { ModuleId };
