import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkRateLimitAsync, getClientIpOrNull, RATE_LIMITS } from "@/lib/rate-limit";
import { validateExternalUrl } from "@/lib/security/url-validator";

const DEFAULT_OSRM_URL = "https://router.project-osrm.org";
const VALID_PROFILES = ["driving", "cycling", "foot"] as const;
const VALID_ENGINES = ["osrm", "google"] as const;

// Google Maps profile → Directions API mode
const GOOGLE_MODE: Record<string, string> = {
  driving: "driving",
  cycling: "bicycling",
  foot: "walking",
};

// Decode Google encoded polyline into [lat, lng][] for Leaflet
function decodePolyline(encoded: string): [number, number][] {
  const result: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result5 = 0;
    do { b = encoded.charCodeAt(index++) - 63; result5 |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result5 & 1) ? ~(result5 >> 1) : result5 >> 1;
    shift = 0; result5 = 0;
    do { b = encoded.charCodeAt(index++) - 63; result5 |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result5 & 1) ? ~(result5 >> 1) : result5 >> 1;
    result.push([lat / 1e5, lng / 1e5]);
  }
  return result;
}

/**
 * POST /api/route-proxy
 * Proxy server-side pour le calcul d'itinéraires via OSRM ou Google Maps Directions.
 * Convertit les coordonnées [lng,lat] (OSRM) → [lat,lng] (Leaflet) côté serveur.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Rate limiting. Cf. AZ-25 : `null` vaut absence d'adresse, pas adresse
  // partagée ; la route est authentifiée, on retombe sur l'identité du compte.
  const ip = getClientIpOrNull(req);
  const bucket = ip ? `ip:${ip}` : `user:${user.id}`;
  const rl = await checkRateLimitAsync(`routing:${bucket}`, RATE_LIMITS.routing);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Trop de requêtes de routage. Réessayez dans un instant." },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { coordinates, profile, engine = "osrm" } = body;

  // Validation engine
  if (!VALID_ENGINES.includes(engine)) {
    return NextResponse.json({ error: "Moteur invalide. Valeurs acceptées : osrm, google" }, { status: 400 });
  }

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

  // Google Maps Directions API
  if (engine === "google") {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Google Maps non configuré sur ce serveur" }, { status: 503 });
    }

    // coordinates are [lng, lat] — convert to lat,lng for Google
    const origin = `${coordinates[0][1]},${coordinates[0][0]}`;
    const destination = `${coordinates[coordinates.length - 1][1]},${coordinates[coordinates.length - 1][0]}`;
    const waypoints = coordinates.length > 2
      ? coordinates.slice(1, -1).map((c: number[]) => `${c[1]},${c[0]}`).join("|")
      : undefined;

    const params = new URLSearchParams({
      origin,
      destination,
      mode: GOOGLE_MODE[profile] || "driving",
      key: apiKey,
      language: "fr",
    });
    if (waypoints) params.set("waypoints", waypoints);

    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?${params}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const data = await res.json();

      if (data.status !== "OK" || !data.routes?.[0]) {
        return NextResponse.json(
          { error: data.error_message || `Google Maps : ${data.status}` },
          { status: data.status === "ZERO_RESULTS" ? 422 : 502 }
        );
      }

      const geometry = decodePolyline(data.routes[0].overview_polyline.points);
      const totalDistance = data.routes[0].legs.reduce((acc: number, l: { distance: { value: number } }) => acc + l.distance.value, 0);
      const totalDuration = data.routes[0].legs.reduce((acc: number, l: { duration: { value: number } }) => acc + l.duration.value, 0);

      return NextResponse.json({ geometry, distance: totalDistance, duration: totalDuration });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return NextResponse.json({ error: "Délai d'attente dépassé (15s)" }, { status: 504 });
      }
      return NextResponse.json({ error: "Erreur Google Maps Directions" }, { status: 502 });
    }
  }

  // Determine OSRM URL
  const routingUrl = process.env.ROUTING_API_URL || DEFAULT_OSRM_URL;

  // SSRF validation for custom URLs only
  if (process.env.ROUTING_API_URL) {
    const urlError = validateExternalUrl(process.env.ROUTING_API_URL);
    if (urlError) {
      return NextResponse.json({ error: `URL de routage invalide : ${urlError}` }, { status: 400 });
    }
  }

  // Build OSRM request: coordinates as "lng,lat;lng,lat;..."
  const coordsStr = coordinates.map((c: number[]) => `${c[0]},${c[1]}`).join(";");
  const osrmUrl = `${routingUrl}/route/v1/${profile}/${coordsStr}?geometries=geojson&overview=full`;

  try {
    const res = await fetch(osrmUrl, {
      headers: { "User-Agent": "LorIAx/1.0" },
      signal: AbortSignal.timeout(15000),
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

    // OSRM public server only has a driving profile; foot/cycling durations
    // would be car speeds. Override with realistic estimates:
    //   foot: 5 km/h, cycling: 15 km/h
    const SPEED_MS: Record<string, number> = {
      foot: 3000 / 3600,      // ~0.83 m/s
      cycling: 15000 / 3600,  // ~4.17 m/s
    };
    const speed = SPEED_MS[profile as string];
    const duration = speed ? Math.round(route.distance / speed) : route.duration;

    return NextResponse.json({
      geometry,
      distance: route.distance, // metres
      duration,                 // seconds
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json({ error: "Délai d'attente dépassé (15s)" }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "Erreur de calcul d'itinéraire";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
