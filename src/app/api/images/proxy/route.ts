import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { safeExternalFetch, OutboundRequestError } from "@/lib/security/outbound-fetch";

// Taille max d'une image proxifiée (20 Mo) : garde-fou mémoire.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Types matriciels relayés. Liste blanche assumée : l'ancien filtre testait le
 * seul préfixe `image/`, ce qui laissait passer `image/svg+xml`, exécutable par
 * le navigateur, relayé sur l'origine de l'application (constat INJ-04, audit
 * du 2026-08-19). Aucun de ces types ne porte de script.
 */
const PROXYABLE_TYPES = new Set([
  "image/jpeg",
  "image/jpg", // non standard mais courant sur des serveurs mal configurés
  "image/pjpeg",
  "image/png",
  "image/x-png", // idem
  "image/apng",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

/**
 * Réponse dédiée au refus d'un SVG distant : le SVG est exécutable par le
 * navigateur (constat INJ-04), le refus est volontaire et définitif, mais il
 * doit rester exploitable côté UI. Code et message stables, à consommer par
 * les parcours d'insertion d'image (éditeur, studio design) : un appelant
 * `fetch` peut lire `body.error === SVG_REJECTED_ERROR_CODE` pour afficher un
 * message dédié plutôt que l'échec générique de chargement d'image.
 */
const SVG_REJECTED_ERROR_CODE = "svg-not-supported";
const SVG_REJECTED_MESSAGE = "Les images SVG distantes ne sont pas prises en charge (risque de script embarqué).";

/** Même politique verrouillée que la restitution du studio d'images. */
const ASSET_CSP =
  "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * GET /api/images/proxy?url=https://...
 * Proxy CORS-safe / CSP-safe pour les images externes :
 *  - insertion d'image par URL dans l'éditeur (n'importe quelle source publique) ;
 *  - banques d'images tierces (Pexels, Pixabay…) dont le domaine n'est pas
 *    listé dans la CSP `img-src` ;
 *  - studio design (évite le "tainted canvas" Fabric.js).
 *
 * Sécurité (proxy ouvert, donc défense en profondeur ; constat INJ-08 et
 * volet redirections d'INJ-04, audit du 2026-08-19) :
 *  - réservé aux utilisateurs authentifiés ;
 *  - le fetch passe par `safeExternalFetch` : syntaxe + protocole, résolution
 *    DNS anti-rebinding (`assertPublicHostname`), puis suivi MANUEL des
 *    redirections avec revalidation de chaque saut (l'ancien `redirect:
 *    "follow"` laissait un hôte public initial rediriger en aveugle vers le
 *    réseau interne) ;
 *  - seules les réponses dont le type appartient à `PROXYABLE_TYPES` sont
 *    relayées : le SVG, exécutable par le navigateur, est exclu ;
 *  - la réponse porte `nosniff` et une politique de sécurité verrouillée ;
 *  - taille bornée à 20 Mo, à la fois annoncée et effective.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return new NextResponse("url requis", { status: 400 });

  try {
    new URL(raw);
  } catch {
    return new NextResponse("URL invalide", { status: 400 });
  }

  try {
    const upstream = await safeExternalFetch(raw, {
      maxBytes: MAX_IMAGE_BYTES,
      init: { headers: { Accept: "image/*" } },
      // Pas de credentials — requête publique
    });

    if (!upstream.ok) {
      return new NextResponse("Erreur upstream", { status: upstream.status });
    }

    const rawType = upstream.headers.get("content-type") ?? "";
    const contentType = rawType.split(";")[0]!.trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      return new NextResponse("Contenu non-image refusé", { status: 422 });
    }
    if (!PROXYABLE_TYPES.has(contentType)) {
      if (contentType === "image/svg+xml" || contentType === "image/svg") {
        // Refus volontaire et définitif, distinct du cas générique : réponse
        // JSON exploitable par l'UI (code + message), cf. SVG_REJECTED_ERROR_CODE.
        // Statut inchangé (422, comme le refus générique) pour ne pas rouvrir
        // le contrat de statut déjà couvert ailleurs (INJ-04) ; seul le corps
        // devient exploitable.
        return NextResponse.json(
          { error: SVG_REJECTED_ERROR_CODE, message: SVG_REJECTED_MESSAGE },
          { status: 422 }
        );
      }
      // Autres formats d'image inconnus ou non pris en charge : jamais relayés.
      return new NextResponse("Format d'image non autorisé", { status: 422 });
    }

    const lengthHeader = upstream.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_IMAGE_BYTES) {
      return new NextResponse("Image trop volumineuse", { status: 413 });
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) {
      return new NextResponse("Image trop volumineuse", { status: 413 });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        // Même origine pour Fabric.js : supprime le problème canvas taché.
        "Access-Control-Allow-Origin": "*",
        // Neutralisation (constat INJ-04) : pas de reniflage de type, et
        // politique verrouillée si la réponse est ouverte en navigation.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": ASSET_CSP,
      },
    });
  } catch (err) {
    // Message générique : ne pas révéler au client la raison précise (adresse
    // privée, DNS rebinding…), ce qui cartographierait le réseau interne.
    if (err instanceof OutboundRequestError) {
      if (err.reason === "too-large") {
        return new NextResponse("Image trop volumineuse", { status: 413 });
      }
      return new NextResponse("URL non autorisée", { status: 403 });
    }
    return new NextResponse("Erreur lors du proxy", { status: 502 });
  }
}
