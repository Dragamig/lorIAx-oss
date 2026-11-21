import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { safeExternalFetch } from "@/lib/security/outbound-fetch";

export const revalidate = 10;

type ServiceStatus = "up" | "down" | "starting" | "disabled" | "configured" | "unconfigured";

interface ServiceResult {
  status: ServiceStatus;
  latency?: number;
  models?: string[];
  modelStatus?: string;
}

const PROBE_TIMEOUT_MS = 2000;

const SETTINGS_KEYS = [
  "livekit",
  "whisper",
  "voxtral",
  "ollama",
  "collab",
  "ldap",
  "ai_global",
  "email",
  "backup_s3",
  "meeting_rooms_enabled",
] as const;

// Adresses de métadonnées cloud : jamais sondées, même sur un réseau privé.
const METADATA_HOST = /^(169\.254\.|\[?fe80:|metadata\.google\.internal$|metadata\.goog$)/i;

/**
 * Sonde sortante. Les services d'une instance auto-hébergée vivent sur le
 * réseau privé (conteneurs voisins), d'où `allowPrivateTargets` ; en revanche
 * les métadonnées cloud sont refusées et aucune redirection n'est suivie.
 */
async function timedFetch(url: string, init?: RequestInit) {
  const start = Date.now();
  if (METADATA_HOST.test(new URL(url).hostname)) {
    throw new Error("Cible refusée");
  }
  const res = await safeExternalFetch(url, {
    timeoutMs: PROBE_TIMEOUT_MS,
    maxRedirects: 0,
    allowPrivateTargets: true,
    init,
  });
  return { res, latency: Date.now() - start };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, [...SETTINGS_KEYS]));

  const settings: Record<string, unknown> = {};
  for (const row of rows) settings[row.key] = row.value;

  const get = (key: string): Record<string, unknown> => {
    const v = settings[key];
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  };

  const lk = get("livekit");
  const w = get("whisper");
  const v = get("voxtral");
  const o = get("ollama");
  const collab = get("collab");
  const ldap = get("ldap");
  const ai = get("ai_global");
  const email = get("email");
  const backup = get("backup_s3");
  // Forme canonique : {"enabled": bool} (cf. migration 0045, manifeste
  // meeting-rooms → toggleField "enabled").
  const meetingRooms = get("meeting_rooms_enabled");
  const meetingRoomsEnabled = Boolean(meetingRooms.enabled);

  const isLocalUrl = (url: string) =>
    /^(wss?|https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(url);

  const probeLivekit = async (): Promise<ServiceResult> => {
    const url = (lk.livekitUrl as string) || process.env.LIVEKIT_URL || "";
    const apiKey = (lk.livekitApiKey as string) || process.env.LIVEKIT_API_KEY || "";
    const apiSecret = (lk.livekitApiSecret as string) || process.env.LIVEKIT_API_SECRET || "";
    if (!url || !apiKey || !apiSecret || isLocalUrl(url)) {
      return { status: "unconfigured" };
    }
    try {
      const httpUrl = url.replace(/^wss?:\/\//, "http://");
      const { res, latency } = await timedFetch(httpUrl);
      return { status: res.ok ? "up" : "down", latency };
    } catch {
      return { status: "down" };
    }
  };

  const probeWhisper = async (): Promise<ServiceResult> => {
    const url = (w.whisperApiUrl as string) || process.env.WHISPER_API_URL || "";
    if (!url || isLocalUrl(url)) {
      return { status: "unconfigured" };
    }
    try {
      const { res, latency } = await timedFetch(`${url}/health`);
      return { status: res?.ok ? "up" : "down", latency };
    } catch {
      return { status: "down" };
    }
  };

  const probeVoxtral = async (): Promise<ServiceResult> => {
    const url = (v.voxtralApiUrl as string) || process.env.VOXTRAL_API_URL || "";
    if (!url || isLocalUrl(url)) {
      return { status: "unconfigured" };
    }
    try {
      const { res, latency } = await timedFetch(`${url}/health`);
      if (res.ok) {
        const data = await res.json();
        return { status: "up", latency, modelStatus: data.status };
      }
      const data = await res.json().catch(() => ({}));
      const s = data.status === "downloading" || data.status === "loading" ? "starting" : "down";
      return { status: s, latency, modelStatus: data.status };
    } catch {
      return { status: "down" };
    }
  };

  const probeOllama = async (): Promise<ServiceResult> => {
    const url = (o.ollamaBaseUrl as string) || process.env.OLLAMA_BASE_URL || "";
    if (!url || isLocalUrl(url)) {
      return { status: "unconfigured" };
    }
    try {
      const { res, latency } = await timedFetch(`${url}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: Record<string, unknown>) => m.name as string);
        return { status: "up", latency, models };
      }
      return { status: "down", latency };
    } catch {
      return { status: "down" };
    }
  };

  const probeCollab = async (): Promise<ServiceResult> => {
    if (collab.collabEnabled === false) return { status: "disabled" };
    try {
      const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const { res, latency } = await timedFetch(`${appUrl}/api/health`);
      return { status: res.ok ? "up" : "down", latency };
    } catch {
      return { status: "down" };
    }
  };

  const [livekit, whisper, voxtral, ollama, collabRes] = await Promise.all([
    lk.livekitEnabled === false ? Promise.resolve<ServiceResult>({ status: "disabled" }) : probeLivekit(),
    w.whisperEnabled === false ? Promise.resolve<ServiceResult>({ status: "disabled" }) : probeWhisper(),
    probeVoxtral(),
    probeOllama(),
    probeCollab(),
  ]);

  const results: Record<string, ServiceResult> = {
    livekit,
    whisper,
    voxtral,
    ollama,
    collab: collabRes,
    ldap: !ldap.ldapEnabled
      ? { status: "disabled" }
      : { status: ldap.ldapUrl ? "configured" : "unconfigured" },
    ai: { status: ai.enabled ? "up" : "disabled" },
    email: {
      status: !email.emailEnabled
        ? "disabled"
        : !!email.smtpHost || (typeof email.resendApiKey === "string" && email.resendApiKey.length > 0)
          ? "configured"
          : "unconfigured",
    },
    backup: {
      status: !backup.enabled
        ? "disabled"
        : !!(backup.s3BackupEndpoint && backup.s3BackupBucket && backup.s3BackupAccessKey && backup.s3BackupSecretKey)
          ? "configured"
          : "unconfigured",
    },
    meetingRooms: { status: meetingRoomsEnabled ? "up" : "disabled" },
  };

  return NextResponse.json(results);
}
