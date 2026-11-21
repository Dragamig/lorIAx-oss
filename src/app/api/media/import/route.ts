import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { UUID_RE, readJsonObject } from "@/lib/media/folders-http";
import { importRemoteImage } from "@/lib/media/import-remote";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { getMediaDetail } from "@/lib/media/metadata";

const bodySchema = z
  .object({
    url: z.string().min(1).max(2048),
    spaceId: z.string().regex(UUID_RE).nullable().optional(),
    origin: z.enum(["upload", "stock"]),
    displayName: z.string().max(255).optional(),
  })
  .strict();

/** Codes d'erreur stables, traduits côté client (`library.picker.errors.*`). */
const KNOWN_CODES = new Set([
  "remote_status",
  "remote_unreachable",
  "url_refused",
  "space_required",
  "too_large",
  "bad_type",
  "forbidden",
  "rate_limited",
  "quota_exceeded",
  "not_found",
  "invalid_request",
  "import_failed",
]);

function errorCode(status: number, error: string): string {
  if (KNOWN_CODES.has(error)) return error;
  if (status === 403) return "forbidden";
  if (status === 413) return "too_large";
  if (status === 415) return "bad_type";
  if (status === 507) return "quota_exceeded";
  if (status === 404) return "not_found";
  return "import_failed";
}

const fail = (code: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error: code }, { status, headers });

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return fail("unauthenticated", 401);

  const orgId = await getRequestOrgId(user);
  if (!orgId) return fail("forbidden", 403);

  const limit = await checkRateLimitAsync(`media-import:${user.id}`, RATE_LIMITS.mediaImport);
  if (!limit.success) {
    const retry = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return fail("rate_limited", 429, { "Retry-After": String(retry) });
  }

  const raw = await readJsonObject(req);
  if (!raw) return fail("invalid_request", 400);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", 400);
  const { url, origin, displayName } = parsed.data;
  const spaceId = parsed.data.spaceId ?? null;

  // Espace d'une autre organisation : 404 silencieux, indiscernable d'un espace inconnu.
  if (spaceId) {
    const [row] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.organizationId, orgId)))
      .limit(1);
    if (!row) return fail("not_found", 404);
  }

  const result = await importRemoteImage({ user, orgId, spaceId, url, origin, displayName, signal: req.signal });
  if (!result.ok) {
    return fail(errorCode(result.status, result.error), result.status);
  }

  if (req.signal.aborted) return fail("import_failed", 400);
  const detail = await getMediaDetail(user, orgId, result.media.id);
  if (!detail) return fail("not_found", 404);
  return NextResponse.json({ media: detail }, { status: 201, headers: NO_STORE });
}
