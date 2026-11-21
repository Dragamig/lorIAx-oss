import { getSetting } from "@/lib/settings/system-settings";

/** Surfaces de recherche pouvant beneficier du reclassement. */
export type RerankSurface = "chat" | "help" | "search";

export interface RerankSettings {
  /** Interrupteur maitre : eteint, aucune surface ne reclasse. */
  enabled: boolean;
  /** Chat sur documents (RAG documents). */
  chat: boolean;
  /** Assistant d'aide (base de connaissances produit). */
  help: boolean;
  /** Recherche generale (/api/search). */
  search: boolean;
}

const ALL_OFF: RerankSettings = {
  enabled: false,
  chat: false,
  help: false,
  search: false,
};

/** Clé du réglage dans `system_settings`. */
export const RERANK_SETTING_KEY = "rerank";

function readBoolean(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

/**
 * Normalise la valeur brute du reglage. Fonction pure, tolerante : toute
 * forme inattendue rend le reclassement eteint (fail-closed), jamais une
 * activation accidentelle.
 */
export function normalizeRerankSettings(raw: unknown): RerankSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...ALL_OFF };
  }
  const source = raw as Record<string, unknown>;
  return {
    enabled: readBoolean(source, "enabled"),
    chat: readBoolean(source, "chat"),
    help: readBoolean(source, "help"),
    search: readBoolean(source, "search"),
  };
}

/** Lit les interrupteurs en base. Tout eteint par defaut. */
export async function getRerankSettings(): Promise<RerankSettings> {
  try {
    const raw = await getSetting<unknown>(RERANK_SETTING_KEY);
    return normalizeRerankSettings(raw);
  } catch {
    return { ...ALL_OFF };
  }
}

/** Vrai si l'interrupteur maitre ET la surface demandee sont armes. */
export async function isRerankEnabledFor(
  surface: RerankSurface
): Promise<boolean> {
  const settings = await getRerankSettings();
  return settings.enabled && settings[surface];
}
