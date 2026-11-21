import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const DEFAULT_LIVEKIT_URL = "ws://localhost:7880";

export interface LiveKitConfig {
  livekitEnabled: boolean;
  livekitUrl: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
  livekitEgressPath?: string;
}

/**
 * Retrieve LiveKit configuration from system_settings (key "livekit").
 * Falls back to env vars, then to defaults.
 */
export async function getLiveKitConfig(): Promise<LiveKitConfig> {
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, "livekit"))
      .limit(1);

    if (rows.length > 0) {
      const stored = rows[0].value as Partial<LiveKitConfig>;
      return {
        livekitEnabled:
          stored.livekitEnabled ??
          (process.env.LIVEKIT_ENABLED === "true"),
        livekitUrl:
          stored.livekitUrl ||
          process.env.LIVEKIT_URL ||
          DEFAULT_LIVEKIT_URL,
        livekitApiKey:
          stored.livekitApiKey ||
          process.env.LIVEKIT_API_KEY,
        livekitApiSecret:
          stored.livekitApiSecret ||
          process.env.LIVEKIT_API_SECRET,
        livekitEgressPath:
          stored.livekitEgressPath ||
          process.env.LIVEKIT_EGRESS_PATH,
      };
    }
  } catch {
    // DB not available — fallback to env
  }

  return {
    livekitEnabled: process.env.LIVEKIT_ENABLED === "true",
    livekitUrl: process.env.LIVEKIT_URL || DEFAULT_LIVEKIT_URL,
    livekitApiKey: process.env.LIVEKIT_API_KEY,
    livekitApiSecret: process.env.LIVEKIT_API_SECRET,
    livekitEgressPath: process.env.LIVEKIT_EGRESS_PATH,
  };
}

// Cache courte durée de l'URL LiveKit pour la CSP (connect-src). Le proxy Node
// (src/proxy.ts) s'exécute à chaque requête de page : sans cache, ce serait une
// lecture DB par requête. Le TTL propage en ~30 s un changement fait dans le
// menu admin. Le process serveur étant long-vécu (server.ts), l'état module
// persiste entre les requêtes.
let _cspUrlCache: { url: string; expiresAt: number } | null = null;
const CSP_URL_TTL_MS = 30_000;

/**
 * URL du serveur LiveKit destinée à l'allowlist CSP `connect-src`.
 * Résolue via getLiveKitConfig() (system_settings DB → env), avec cache TTL.
 * Renvoie "" si rien n'est configuré (aucun host ajouté à la CSP).
 */
export async function getLiveKitUrlForCsp(): Promise<string> {
  const now = Date.now();
  if (_cspUrlCache && _cspUrlCache.expiresAt > now) return _cspUrlCache.url;

  let url = "";
  try {
    const cfg = await getLiveKitConfig();
    url = cfg.livekitUrl || "";
  } catch {
    url = process.env.LIVEKIT_URL || "";
  }

  _cspUrlCache = { url, expiresAt: now + CSP_URL_TTL_MS };
  return url;
}
