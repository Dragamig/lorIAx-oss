import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { safeFetch } from "@/lib/security/safe-fetch";

export const runtime = "nodejs";

// L'URL provient exclusivement de la configuration serveur (system_settings
// ou OLLAMA_BASE_URL), jamais de la requête. Ollama tourne par défaut sur
// localhost:11434 en auto-hébergement : la dérogation est indispensable.
const ALLOW_PRIVATE = true;

async function getOllamaUrl(): Promise<string> {
  try {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "ollama"));
    if (row?.value && (row.value as Record<string, unknown>).ollamaBaseUrl) {
      return (row.value as Record<string, unknown>).ollamaBaseUrl as string;
    }
  } catch {
    // Fallback to env
  }
  return process.env.OLLAMA_BASE_URL || "http://localhost:11434";
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  try {
    const ollamaUrl = await getOllamaUrl();
    const res = await safeFetch(`${ollamaUrl.replace(/\/+$/, "")}/api/tags`, {
      timeoutMs: 10000,
      allowPrivate: ALLOW_PRIVATE,
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Ollama non disponible" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Impossible de contacter Ollama" },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const modelName = body.name;
    if (!modelName || typeof modelName !== "string") {
      return NextResponse.json({ error: "Nom du modèle requis" }, { status: 400 });
    }

    const ollamaUrl = await getOllamaUrl();
    const res = await safeFetch(`${ollamaUrl.replace(/\/+$/, "")}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: false }),
      timeoutMs: 600000, // 10 min for large models
      allowPrivate: ALLOW_PRIVATE,
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch {
    return NextResponse.json(
      { error: "Échec du pull — vérifiez qu'Ollama est démarré" },
      { status: 502 }
    );
  }
}
