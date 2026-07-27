import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { validateExternalUrl } from "@/lib/security/url-validator";
import { SafeFetchError, isBlockedTargetError, safeFetch } from "@/lib/security/safe-fetch";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// Cette route alimente les blocs base de données et tableur : ingérer de gros
// jeux JSON ou CSV est son métier. Le plafond porte sur les octets bruts comme
// sur les octets décompressés. Il reste volontairement modéré car le corps est
// entièrement bufferisé en mémoire, puis re-sérialisé par NextResponse.json
// sur la branche rest-api, ce qui multiplie l'empreinte côté V8.
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/data-proxy
 * Proxy server-side pour récupérer des données externes (évite CORS).
 * Supporte : REST API (JSON) et Google Sheets (CSV public).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Plafond de débit : sans lui, N requêtes parallèles d'un même compte
  // multiplient par N les 10 Mio bufferisés en mémoire.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`data-proxy:${ip}`, RATE_LIMITS.dataProxy);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Trop de requêtes. Réessayez dans un instant." },
      { status: 429 }
    );
  }

  const body = await req.json();
  const { type, url, jsonPath, gid } = body;

  if (!url || !type) {
    return NextResponse.json({ error: "URL et type requis" }, { status: 400 });
  }

  // Validation URL + protection SSRF
  const urlError = validateExternalUrl(url);
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 });
  }

  try {
    if (type === "rest-api") {
      // URL fournie par l'utilisateur : aucune dérogation réseau privé.
      const res = await safeFetch(url, {
        headers: { Accept: "application/json" },
        timeoutMs: 15000,
        maxBytes: MAX_PAYLOAD_BYTES,
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `HTTP ${res.status}: ${res.statusText}` },
          { status: 502 }
        );
      }

      const json = await res.json();

      // Extraction via chemin JSON (notation pointée simple)
      let data = json;
      if (jsonPath) {
        // Protection contre prototype pollution
        const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

        for (const key of jsonPath.split(".")) {
          if (FORBIDDEN_KEYS.has(key)) {
            return NextResponse.json({ error: 'Invalid jsonPath' }, { status: 400 })
          }
          if (data != null && typeof data === "object") {
            data = (data as Record<string, unknown>)[key];
          } else {
            break;
          }
        }
      }

      if (!Array.isArray(data)) {
        return NextResponse.json(
          { error: "Les données extraites ne sont pas un tableau. Vérifiez le chemin JSON." },
          { status: 422 }
        );
      }

      return NextResponse.json({ data });
    }

    if (type === "google-sheets") {
      const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (!match) {
        return NextResponse.json({ error: "URL Google Sheets invalide" }, { status: 400 });
      }
      const sheetId = match[1];
      const sheetGid = gid || "0";

      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGid}`;
      const res = await safeFetch(csvUrl, {
        timeoutMs: 15000,
        maxBytes: MAX_PAYLOAD_BYTES,
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: `Google Sheets HTTP ${res.status}, vérifiez que la feuille est partagée publiquement` },
          { status: 502 }
        );
      }

      const csv = await res.text();
      return NextResponse.json({ csv });
    }

    return NextResponse.json({ error: "Type de source non supporté" }, { status: 400 });
  } catch (err: unknown) {
    if (isBlockedTargetError(err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof SafeFetchError && err.code === "timeout") {
      return NextResponse.json({ error: "Délai d'attente dépassé (15s)" }, { status: 504 });
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json({ error: "Délai d'attente dépassé (15s)" }, { status: 504 });
    }
    if (err instanceof SafeFetchError && err.code === "response_too_large") {
      return NextResponse.json(
        { error: "Réponse trop volumineuse (limite 10 Mo)" },
        { status: 502 }
      );
    }
    // Le message brut d'une erreur réseau expose l'adresse résolue et le port
    // ("connect ECONNREFUSED 93.184.216.34:22"), ce qui transformerait cette
    // route en scanner de ports. Détail journalisé côté serveur uniquement.
    logger.warn({ err, type }, "[data-proxy] Échec de récupération");
    return NextResponse.json({ error: "Erreur de récupération" }, { status: 502 });
  }
}
