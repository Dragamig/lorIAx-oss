import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateCalDAV,
  parseCalDAVPath,
  handlePropfind,
  handleReport,
  handleGetEvent,
  handlePutEvent,
  handleDeleteEvent,
  handleOptions,
} from "@/lib/calendar/caldav-server";
import {
  checkRateLimit,
  peekRateLimit,
  getClientIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function isCaldavEnabled(): boolean {
  return process.env.CALDAV_ENABLED === "true";
}

function getBaseUrl(request: NextRequest): string {
  if (process.env.CALDAV_BASE_URL) return process.env.CALDAV_BASE_URL.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function caldavHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    DAV: "1, 2, calendar-access",
    "Content-Type": "application/xml; charset=utf-8",
    ...extra,
  };
}

function unauthorized(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="LorIAx CalDAV"' },
  });
}

/** Identifiant présenté en Basic, en minuscules, ou null (Bearer, en-tête illisible). */
function basicAuthUsername(authHeader: string): string | null {
  if (!authHeader.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator <= 0) return null;
    return decoded.slice(0, separator).toLowerCase().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Clé du limiteur d'échecs, ou null quand aucune dimension fiable n'est disponible.
 *
 * `getClientIp` renvoie la chaîne « unknown » en l'absence de `x-forwarded-for`,
 * cas courant en auto-hébergement, et notamment quand CalDAV est servi par le
 * serveur Node maison qui porte PROPFIND et REPORT. Limiter sur cette valeur
 * réunirait tous les clients dans un même compteur : n'importe qui gèlerait alors
 * CalDAV pour l'installation entière, sans même s'authentifier. On retombe donc
 * sur l'identifiant présenté, qui est la dimension réellement pertinente pour une
 * attaque par force brute. Reste hors limitation le seul cas « pas d'adresse
 * résolue et jeton Bearer », où le secret deviné serait une clé d'API de 32 octets.
 */
function caldavRateLimitKey(request: NextRequest, authHeader: string): string | null {
  const ip = getClientIp(request);
  if (ip !== "unknown") return `caldav-auth:ip:${ip}`;

  const username = basicAuthUsername(authHeader);
  return username ? `caldav-auth:user:${username}` : null;
}

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!isCaldavEnabled()) {
    return NextResponse.json(
      { error: "CalDAV is disabled. Set CALDAV_ENABLED=true to enable." },
      { status: 503 }
    );
  }

  // Support X-HTTP-Method-Override for PROPFIND/REPORT (rewritten by server.ts)
  const override = request.headers.get("x-http-method-override");
  const method = override?.toUpperCase() || request.method.toUpperCase();

  // OPTIONS — no auth required
  if (method === "OPTIONS") {
    const result = handleOptions();
    return new NextResponse(null, { status: result.status, headers: result.headers });
  }

  // H11 : l'authentification Basic est rejouée à chaque requête CalDAV, sans
  // limitation le point d'entrée est un oracle de force brute sur les mots de passe.
  // Seuls les identifiants PRESENTES ET REJETES sont comptés, jamais le défi
  // d'authentification : une requête sans en-tête Authorization est le premier
  // échange normal de tout client Basic, et c'est exactement ce que produit la
  // découverte RFC 6764 via /.well-known/caldav. La compter ferait tomber en 429
  // la synchronisation de tous les postes partageant une même adresse.
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return unauthorized();
  }

  const rateLimitKey = caldavRateLimitKey(request, authHeader);

  if (rateLimitKey && !peekRateLimit(rateLimitKey, RATE_LIMITS.caldavAuth).success) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": "900" },
    });
  }

  // Authenticate
  const user = await authenticateCalDAV(request);
  if (!user) {
    if (rateLimitKey) checkRateLimit(rateLimitKey, RATE_LIMITS.caldavAuth);
    return unauthorized();
  }

  const pathSegments = (await params).path;
  const parsedPath = parseCalDAVPath(pathSegments);
  const baseUrl = getBaseUrl(request);
  const body = method === "PROPFIND" || method === "REPORT" || method === "PUT"
    ? await request.text()
    : "";

  switch (method) {
    case "PROPFIND": {
      const result = await handlePropfind(user, parsedPath, body, baseUrl);
      return new NextResponse(result.body, {
        status: result.status,
        headers: caldavHeaders(),
      });
    }

    case "REPORT": {
      const result = await handleReport(user, parsedPath, body, baseUrl);
      return new NextResponse(result.body, {
        status: result.status,
        headers: caldavHeaders(),
      });
    }

    case "GET": {
      const result = await handleGetEvent(user, parsedPath);
      return new NextResponse(result.body, {
        status: result.status,
        headers: result.headers,
      });
    }

    case "PUT": {
      const result = await handlePutEvent(user, parsedPath, body);
      return new NextResponse(result.body || null, {
        status: result.status,
        headers: result.headers,
      });
    }

    case "DELETE": {
      const result = await handleDeleteEvent(user, parsedPath);
      return new NextResponse(result.body || null, { status: result.status });
    }

    default:
      return new NextResponse("Method not allowed", { status: 405 });
  }
}

// Next.js App Router: export handlers for each method
// CalDAV uses PROPFIND and REPORT which are non-standard, so we use catch-all via GET/POST/PUT/DELETE + custom method handling
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

// PROPFIND and REPORT are non-standard HTTP methods
// Next.js doesn't support them directly — we handle them via the custom server (server.ts)
// or via a middleware rewrite. For now, clients can POST with X-HTTP-Method-Override header.
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  // Allow PATCH as a fallback for PROPFIND/REPORT via X-HTTP-Method-Override
  return handleRequest(request, context);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}
