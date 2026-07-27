import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { safeFetch } from "@/lib/security/safe-fetch";

export const runtime = "nodejs";

// Toutes les URL sondées ici proviennent exclusivement de la configuration
// serveur (table system_settings ou variables d'environnement). Sonder des
// services internes est précisément la fonction de cette route en
// auto-hébergement (LiveKit, Whisper, Voxtral, Ollama, l'app elle-même),
// d'où la dérogation réseau privé.
const ALLOW_PRIVATE = true;

// Sondes de santé : jamais de redirection suivie, une sonde n'a pas à rebondir.
const PROBE = { allowPrivate: ALLOW_PRIVATE, followRedirects: false } as const;

type ServiceStatus = "up" | "down" | "starting" | "disabled" | "configured" | "unconfigured";

interface ServiceResult {
  status: ServiceStatus;
  latency?: number;
  models?: string[];
  modelStatus?: string;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const results: Record<string, ServiceResult> = {};

  async function getSetting(key: string): Promise<Record<string, unknown>> {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return (row?.value as Record<string, unknown>) ?? {};
  }

  // LiveKit
  try {
    const lk = await getSetting("livekit");
    const url = (lk.livekitUrl as string) || process.env.LIVEKIT_URL || "ws://localhost:7880";
    const httpUrl = url.replace(/^wss?:\/\//, "http://");
    const start = Date.now();
    const res = await safeFetch(httpUrl, { timeoutMs: 5000, ...PROBE });
    results.livekit = { status: res.ok ? "up" : "down", latency: Date.now() - start };
  } catch {
    results.livekit = { status: "down" };
  }

  // Whisper
  try {
    const w = await getSetting("whisper");
    const url = (w.whisperApiUrl as string) || process.env.WHISPER_API_URL || "http://localhost:9000";
    const start = Date.now();
    const res = await safeFetch(`${url}/health`, { timeoutMs: 5000, ...PROBE }).catch(() => null);
    results.whisper = { status: res?.ok ? "up" : "down", latency: Date.now() - start };
  } catch {
    results.whisper = { status: "down" };
  }

  // Voxtral
  try {
    const v = await getSetting("voxtral");
    const url = (v.voxtralApiUrl as string) || process.env.VOXTRAL_API_URL || "http://localhost:9001";
    const start = Date.now();
    const res = await safeFetch(`${url}/health`, { timeoutMs: 5000, ...PROBE });
    if (res.ok) {
      const data = await res.json();
      results.voxtral = { status: "up", latency: Date.now() - start, modelStatus: data.status };
    } else {
      const data = await res.json().catch(() => ({}));
      const s = data.status === "downloading" || data.status === "loading" ? "starting" : "down";
      results.voxtral = { status: s, latency: Date.now() - start, modelStatus: data.status };
    }
  } catch {
    results.voxtral = { status: "down" };
  }

  // Ollama
  try {
    const o = await getSetting("ollama");
    const url = (o.ollamaBaseUrl as string) || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const start = Date.now();
    const res = await safeFetch(`${url}/api/tags`, { timeoutMs: 5000, ...PROBE });
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map((m: Record<string, unknown>) => m.name as string);
      results.ollama = { status: "up", latency: Date.now() - start, models };
    } else {
      results.ollama = { status: "down", latency: Date.now() - start };
    }
  } catch {
    results.ollama = { status: "down" };
  }

  // Collaboration temps réel
  try {
    const collab = await getSetting("collab");
    if (collab.collabEnabled === false) {
      results.collab = { status: "disabled" };
    } else {
      const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const start = Date.now();
      const res = await safeFetch(`${appUrl}/api/health`, { timeoutMs: 3000, ...PROBE });
      results.collab = { status: res.ok ? "up" : "down", latency: Date.now() - start };
    }
  } catch {
    results.collab = { status: "down" };
  }

  // LDAP
  try {
    const ldap = await getSetting("ldap");
    if (!ldap.ldapEnabled) {
      results.ldap = { status: "disabled" };
    } else {
      results.ldap = { status: ldap.ldapUrl ? "up" : "unconfigured" };
    }
  } catch {
    results.ldap = { status: "disabled" };
  }

  // IA globale
  try {
    const ai = await getSetting("ai_global");
    results.ai = { status: ai.enabled ? "up" : "disabled" };
  } catch {
    results.ai = { status: "disabled" };
  }

  // Email
  try {
    const email = await getSetting("email");
    const configured =
      !!email.smtpHost || (typeof email.resendApiKey === "string" && email.resendApiKey.length > 0);
    results.email = { status: configured ? "configured" : "unconfigured" };
  } catch {
    results.email = { status: "unconfigured" };
  }

  // Sauvegardes S3
  try {
    const backup = await getSetting("backup_s3");
    results.backup = { status: backup.enabled ? "configured" : "unconfigured" };
  } catch {
    results.backup = { status: "unconfigured" };
  }

  return NextResponse.json(results);
}
