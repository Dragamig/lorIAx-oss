import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { validateExternalUrl } from "@/lib/security/url-validator";
import { safeExternalFetch, OutboundRequestError } from "@/lib/security/outbound-fetch";

// Borne de taille raisonnable pour une réponse proxifiée (10 Mo).
const MAX_PROXY_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/data-proxy
 * Proxy server-side pour récupérer des données externes (évite CORS).
 * Supporte : REST API (JSON) et Google Sheets (CSV public).
 *
 * Sécurité (constat INJ-08, audit du 2026-08-19) : la route rend le corps
 * intégral de la réponse au client, donc un SSRF y est en lecture complète.
 * Le fetch passe par `safeExternalFetch` (résolution DNS anti-rebinding et
 * revalidation de chaque redirection) plutôt que par un `fetch` en `follow`
 * qui ne validait la cible initiale que par syntaxe.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }
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
      const res = await safeExternalFetch(url, {
        timeoutMs: 15000,
        maxBytes: MAX_PROXY_BYTES,
        init: { headers: { Accept: "application/json" } },
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
      const res = await safeExternalFetch(csvUrl, {
        timeoutMs: 15000,
        maxBytes: MAX_PROXY_BYTES,
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: `Google Sheets HTTP ${res.status} — vérifiez que la feuille est partagée publiquement` },
          { status: 502 }
        );
      }

      const csv = await res.text();
      return NextResponse.json({ csv });
    }

    return NextResponse.json({ error: "Type de source non supporté" }, { status: 400 });
  } catch (err: unknown) {
    // Message générique : ne pas révéler au client la raison précise (adresse
    // privée, DNS rebinding…), ce qui cartographierait le réseau interne.
    if (err instanceof OutboundRequestError) {
      return NextResponse.json({ error: "URL non autorisée" }, { status: 400 });
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json({ error: "Délai d'attente dépassé (15s)" }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "Erreur de récupération";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
