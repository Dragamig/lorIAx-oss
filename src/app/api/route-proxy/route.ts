import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { SafeFetchError, isBlockedTargetError, safeFetch } from "@/lib/security/safe-fetch";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const DEFAULT_OSRM_URL = "https://router.project-osrm.org";
const VALID_PROFILES = ["driving", "cycling", "foot"] as const;

/**
 * POST /api/route-proxy
 * Proxy server-side pour le calcul d'itinéraires via OSRM.
 * Convertit les coordonnées [lng,lat] (OSRM) → [lat,lng] (Leaflet) côté serveur.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Rate limiting
  const ip = getClientIp(req);
  const rl = checkRateLimit(`routing:${ip}`, RATE_LIMITS.routing);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Trop de requêtes de routage. Réessayez dans un instant." },
      { status: 429 }
    );
  }

  const body = await req.json();
  const { coordinates, profile } = body;

  // Validation profile
  if (!profile || !VALID_PROFILES.includes(profile)) {
    return NextResponse.json(
      { error: `Profil invalide. Valeurs acceptées : ${VALID_PROFILES.join(", ")}` },
      { status: 400 }
    );
  }

  // Validation coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 25) {
    return NextResponse.json(
      { error: "Entre 2 et 25 coordonnées requises" },
      { status: 400 }
    );
  }

  for (const coord of coordinates) {
    if (
      !Array.isArray(coord) ||
      coord.length !== 2 ||
      typeof coord[0] !== "number" ||
      typeof coord[1] !== "number" ||
      !isFinite(coord[0]) ||
      !isFinite(coord[1])
    ) {
      return NextResponse.json(
        { error: "Chaque coordonnée doit être un tableau [lng, lat] de nombres valides" },
        { status: 400 }
      );
    }
  }

  // L'URL de base provient exclusivement de la configuration serveur
  // (variable d'env ROUTING_API_URL), jamais de la requête : seules les
  // coordonnées numériques déjà validées entrent dans le chemin.
  // Une instance OSRM auto-hébergée sur le réseau privé est un déploiement
  // légitime (voir la documentation du projet OSRM citée dans .env.example),
  // d'où la dérogation ci-dessous, accordée uniquement si l'exploitant a
  // effectivement configuré sa propre instance.
  const routingUrl = process.env.ROUTING_API_URL || DEFAULT_OSRM_URL;

  let parsedRoutingUrl: URL | null = null;
  try {
    parsedRoutingUrl = new URL(routingUrl);
  } catch {
    parsedRoutingUrl = null;
  }
  if (
    !parsedRoutingUrl ||
    (parsedRoutingUrl.protocol !== "http:" && parsedRoutingUrl.protocol !== "https:")
  ) {
    return NextResponse.json(
      { error: "URL de routage invalide : configuration serveur incorrecte" },
      { status: 500 }
    );
  }

  // Build OSRM request: coordinates as "lng,lat;lng,lat;..."
  const coordsStr = coordinates.map((c: number[]) => `${c[0]},${c[1]}`).join(";");
  const osrmUrl = `${routingUrl.replace(/\/+$/, "")}/route/v1/${profile}/${coordsStr}?geometries=geojson&overview=full`;

  try {
    const res = await safeFetch(osrmUrl, {
      headers: { "User-Agent": "LorIAx/1.0" },
      timeoutMs: 15000,
      // Dérogation uniquement quand l'exploitant a configuré sa propre
      // instance : la cible par défaut est l'OSRM public, qui n'en a pas besoin.
      allowPrivate: Boolean(process.env.ROUTING_API_URL),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Erreur OSRM : HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (data.code !== "Ok" || !data.routes?.[0]) {
      return NextResponse.json(
        { error: data.message || "Aucun itinéraire trouvé" },
        { status: 422 }
      );
    }

    const route = data.routes[0];

    // Convert [lng, lat] (GeoJSON) → [lat, lng] (Leaflet)
    const geometry: [number, number][] = route.geometry.coordinates.map(
      (c: number[]) => [c[1], c[0]] as [number, number]
    );

    return NextResponse.json({
      geometry,
      distance: route.distance, // metres
      duration: route.duration, // seconds
    });
  } catch (err: unknown) {
    if (isBlockedTargetError(err)) {
      return NextResponse.json(
        { error: `URL de routage invalide : ${err.message}` },
        { status: 500 }
      );
    }
    if (
      (err instanceof SafeFetchError && err.code === "timeout") ||
      (err instanceof Error && err.name === "TimeoutError")
    ) {
      return NextResponse.json({ error: "Délai d'attente dépassé (15s)" }, { status: 504 });
    }
    // Message brut jamais renvoyé au client : il exposerait l'adresse et le
    // port de la cible résolue.
    logger.warn({ err }, "[route-proxy] Échec de calcul d'itinéraire");
    return NextResponse.json(
      { error: "Erreur de calcul d'itinéraire" },
      { status: 502 }
    );
  }
}
