import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Constat INJ-24 (audit du 2026-08-19) : ces routes contactent
 * `ollamaBaseUrl` (réglage admin, replié sur `http://localhost:11434`) sans
 * contrainte de protocole ni de redirection, et renvoyaient au client le
 * message d'erreur brut. Réservées aux administrateurs globaux, donc pas de
 * franchissement de frontière de privilège : le risque corrigé est l'oracle
 * de cartographie réseau, pas un accès non autorisé. On ne bloque
 * volontairement pas les adresses privées : pointer un Ollama/vLLM interne
 * est l'usage normal de LorIAx auto-hébergé, d'où le repli localhost en dur.
 */

/** Vérifie que l'URL est analysable et limitée à http/https, sans émettre de requête. */
function parseOutboundUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url;
}

/**
 * Traduit une erreur de requête sortante (échec de transport, avant toute
 * réponse reçue) en message générique, stable pour l'appelant. On distingue
 * trois cas utiles pour un admin qui débogue, sans jamais révéler l'hôte
 * visé, le port, ni le détail de la résolution DNS :
 *  - délai dépassé (Ollama est-il lent ou éteint ?) ;
 *  - redirection refusée (adresse saisie en http alors que la passerelle
 *    redirige vers https, ou inversement) ;
 *  - échec de connexion générique.
 */
function genericOutboundErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return "Délai dépassé en contactant Ollama";
  }
  if (isRefusedRedirect(err)) {
    return "La passerelle a répondu par une redirection, refusée par sécurité. Vérifiez le protocole (http/https) de l'adresse configurée.";
  }
  return "Impossible de contacter Ollama";
}

/** Vrai si l'échec vient d'une redirection refusée (`redirect: "error"`). */
function isRefusedRedirect(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const causeMessage = cause instanceof Error ? cause.message : "";
  return /redirect/i.test(err.message) || /redirect/i.test(causeMessage);
}

const MAX_PROVIDER_ERROR_LENGTH = 500;

/** Tronque un texte pour éviter de relayer un corps de réponse volumineux. */
function truncate(text: string, max = MAX_PROVIDER_ERROR_LENGTH): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Message d'erreur pour une réponse effectivement reçue d'Ollama.
 *
 * Une réponse 4xx vient du fournisseur lui-même (clé refusée, modèle
 * inconnu, requête malformée) : elle ne cartographie rien du réseau interne
 * et peut être rendue telle quelle, tronquée. Une 5xx peut provenir d'un
 * service tiers mal identifié (bannière interne, panneau d'admin) derrière
 * l'adresse configurée : elle reste générique par défense en profondeur.
 */
function providerErrorMessage(status: number, bodyText: string): string {
  if (status >= 400 && status < 500) {
    const detail = bodyText ? truncate(bodyText) : "";
    return detail ? `Ollama a refusé la requête (${status}) : ${detail}` : `Ollama a refusé la requête (${status})`;
  }
  return `Ollama a répondu avec une erreur serveur (${status})`;
}

/**
 * Construit une cible sous `parsed`, en préservant le chemin de l'URL
 * configurée (normalisé sans barre oblique finale). `parsed.origin` seul
 * écraserait un service publié derrière un proxy inverse en sous-chemin,
 * par exemple `https://ia.exemple.fr/ollama`, en l'appelant sur
 * `https://ia.exemple.fr/api/tags` au lieu de
 * `https://ia.exemple.fr/ollama/api/tags` (constat corrigé en revue).
 */
function buildOllamaTarget(parsed: URL, suffix: string): string {
  const base = (parsed.origin + parsed.pathname).replace(/\/+$/, "");
  return `${base}${suffix}`;
}

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

  const ollamaUrl = await getOllamaUrl();
  const parsed = parseOutboundUrl(ollamaUrl);
  if (!parsed) {
    console.error("[admin/services/ollama-models] URL Ollama configurée invalide");
    return NextResponse.json({ error: "URL Ollama configurée invalide" }, { status: 400 });
  }

  try {
    const res = await fetch(buildOllamaTarget(parsed, "/api/tags"), {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.error(`[admin/services/ollama-models] réponse Ollama non OK : ${res.status}`);
      const status = res.status >= 400 && res.status < 500 ? 400 : 502;
      return NextResponse.json({ error: providerErrorMessage(res.status, bodyText) }, { status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[admin/services/ollama-models] échec de la requête sortante (GET) :", err);
    return NextResponse.json(
      { error: genericOutboundErrorMessage(err) },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  // Le téléchargement d'un modèle n'observe pas le service, il le fait
  // travailler : il consomme le disque et le réseau du serveur Ollama partagé
  // par TOUTE l'instance, et sa configuration est réservée à l'administration
  // d'instance depuis le correctif AZ-08. Laisser un admin d'organisation
  // déclencher un `pull` sur une ressource qu'il ne peut plus configurer
  // n'aurait aucun sens. La lecture des modèles reste ouverte au rôle `admin`,
  // qui en a besoin pour choisir un modèle dans les écrans d'IA.
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const body = await request.json();
  const modelName = body.name;
  if (!modelName || typeof modelName !== "string") {
    return NextResponse.json({ error: "Nom du modèle requis" }, { status: 400 });
  }

  const ollamaUrl = await getOllamaUrl();
  const parsed = parseOutboundUrl(ollamaUrl);
  if (!parsed) {
    console.error("[admin/services/ollama-models] URL Ollama configurée invalide");
    return NextResponse.json({ error: "URL Ollama configurée invalide" }, { status: 400 });
  }

  try {
    const res = await fetch(buildOllamaTarget(parsed, "/api/pull"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: false }),
      signal: AbortSignal.timeout(600000), // 10 min for large models
      redirect: "error",
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[admin/services/ollama-models] échec du pull (${res.status}) :`, errText);
      // Une 4xx vient d'Ollama lui-même : le cas le plus fréquent est une
      // faute de frappe dans le nom du modèle. Le rendre est plus utile
      // qu'un message générique qui laisserait croire qu'Ollama est éteint.
      const status = res.status >= 400 && res.status < 500 ? 400 : 502;
      return NextResponse.json({ error: providerErrorMessage(res.status, errText) }, { status });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error("[admin/services/ollama-models] échec de la requête sortante (POST) :", err);
    return NextResponse.json(
      { error: genericOutboundErrorMessage(err) },
      { status: 502 }
    );
  }
}
