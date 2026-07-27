import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { safeFetch } from "@/lib/security/safe-fetch";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { apiBaseUrl, apiKey, connectorType } = await request.json();

  // Pour Mistral, utiliser l'URL officielle par défaut
  const effectiveBaseUrl =
    connectorType === "mistral" && !apiBaseUrl
      ? "https://api.mistral.ai"
      : apiBaseUrl;

  if (!effectiveBaseUrl) {
    return NextResponse.json(
      { error: "L'URL de base est requise" },
      { status: 400 }
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // Cette route sert à configurer un fournisseur IA, y compris auto-hébergé
  // (Ollama, LM Studio, vLLM sur le réseau interne). Elle est réservée aux
  // administrateurs globaux et l'URL est celle que l'admin s'apprête à
  // enregistrer comme configuration serveur, d'où allowPrivate.
  const ALLOW_PRIVATE = true;

  // 1. Try OpenAI-compatible /v1/models
  try {
    const url = `${effectiveBaseUrl.replace(/\/+$/, "")}/v1/models`;
    const res = await safeFetch(url, {
      headers,
      timeoutMs: 10_000,
      allowPrivate: ALLOW_PRIVATE,
    });

    if (res.ok) {
      const data = await res.json();
      const models: string[] = (data.data || []).map(
        (m: { id: string }) => m.id
      );
      if (models.length > 0) {
        return NextResponse.json({ models: models.sort() });
      }
    }
  } catch {
    // Try next strategy
  }

  // 2. Try Ollama-specific /api/tags
  try {
    const url = `${effectiveBaseUrl.replace(/\/+$/, "")}/api/tags`;
    const res = await safeFetch(url, {
      headers,
      timeoutMs: 10_000,
      allowPrivate: ALLOW_PRIVATE,
    });

    if (res.ok) {
      const data = await res.json();
      const models: string[] = (data.models || []).map(
        (m: { name: string }) => m.name
      );
      if (models.length > 0) {
        return NextResponse.json({ models: models.sort() });
      }
    }
  } catch {
    // Both strategies failed
  }

  return NextResponse.json(
    { error: "Impossible de récupérer la liste des modèles" },
    { status: 502 }
  );
}
