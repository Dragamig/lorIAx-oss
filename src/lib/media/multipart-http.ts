import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "@/types";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { checkRateLimitAsync } from "@/lib/rate-limit";

type RateLimitConfig = { maxRequests: number; windowMs: number };
import { UUID_RE, readJsonObject } from "@/lib/media/folders-http";
import { MultipartInputError } from "@/lib/media/multipart";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export const jsonError = (error: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });

export const notFound = () => jsonError("Introuvable", 404);

/** Session et organisation tirées du serveur, jamais du corps de la requête. */
export async function authContext(): Promise<{ user: SessionUser; orgId: string } | NextResponse> {
  const user = await getSessionUser();
  if (!user) return jsonError("Non authentifié", 401);
  const orgId = await getRequestOrgId(user);
  if (!orgId) return jsonError("Organisation introuvable", 404);
  return { user, orgId };
}

export async function limited(bucket: string, userId: string, cfg: RateLimitConfig): Promise<NextResponse | null> {
  const r = await checkRateLimitAsync(`${bucket}:${userId}`, cfg);
  if (r.success) return null;
  const retry = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
  return jsonError("Trop de requêtes", 429, { "Retry-After": String(retry) });
}

/** Identifiant d'envoi invalide : même 404 qu'un envoi inconnu ou d'autrui. */
export const isUploadId = (id: string) => UUID_RE.test(id);

export async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return readJsonObject(req);
}

/** `MultipartInputError` devient 400, le reste remonte. */
export function inputErrorResponse(e: unknown): NextResponse {
  if (e instanceof MultipartInputError) return jsonError(e.message, 400);
  throw e;
}
