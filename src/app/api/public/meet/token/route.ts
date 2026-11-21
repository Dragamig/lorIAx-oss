import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, spaces, publicShares, meetings } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { generateLiveKitToken } from "@/lib/meet/livekit-token";
import { getLiveKitConfig } from "@/lib/meet/livekit-config";
import { z } from "zod";
import logger from "@/lib/logger";
import { checkRateLimitAsync, getClientIpOrNull, ipKeyPart, RATE_LIMITS } from "@/lib/rate-limit";

// ─── Validation Schema ──────────────────────────────────────────────────────

const guestTokenSchema = z.object({
  shareToken: z.string().min(1).max(64),
  roomName: z.string().min(1).max(100),
  displayName: z.string().min(1).max(50).trim(),
});

type GuestTokenRequest = z.infer<typeof guestTokenSchema>;

// ─── Display Name Sanitization ──────────────────────────────────────────────

function sanitizeDisplayName(name: string): string {
  return name
    .trim()
    .substring(0, 50)
    .replace(/[\u0000-\u001f]/g, "");
}

// ─── Quota ─────────────────────────────────────────────────────────────────

/**
 * Plafond du seau des demandes SANS adresse identifiable.
 *
 * AZ-25 : `getClientIp` rend la CONSTANTE `UNKNOWN_CLIENT_IP` quand aucune
 * adresse n'est déterminable. L'indexer comme une adresse mettait tous les
 * clients anonymes de cette route publique et non authentifiée dans le MÊME
 * seau : vingt demandes de n'importe qui fermaient alors l'accès invité à tout
 * le monde. Sans adresse, aucune distinction n'est possible et le seau est
 * forcément commun ; on l'isole donc de celui des clients identifiés et on lui
 * donne un plafond volontairement plus large, assez pour ne pas casser un usage
 * légitime, assez borné pour que l'abus en masse reste impossible.
 */
const MEET_MAX_WITHOUT_IP = 120;

// ─── POST Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Quota par adresse cliente, seau distinct quand elle est indéterminable.
    const clientIp = getClientIpOrNull(request);
    const rateLimitResult = await checkRateLimitAsync(
      `guest_meet:${ipKeyPart(clientIp)}`,
      clientIp
        ? RATE_LIMITS.meet
        : { maxRequests: MEET_MAX_WITHOUT_IP, windowMs: RATE_LIMITS.meet.windowMs }
    );

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400 }
      );
    }

    let validatedBody: GuestTokenRequest;
    try {
      validatedBody = guestTokenSchema.parse(body);
    } catch {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    const { shareToken, roomName, displayName } = validatedBody;
    const sanitizedDisplayName = sanitizeDisplayName(displayName);

    // ─── Verification 1: Find public share by token ─────────────────────────

    let share;
    try {
      const [s] = await db
        .select()
        .from(publicShares)
        .where(
          and(
            eq(publicShares.token, shareToken),
            isNull(publicShares.revokedAt)
          )
        )
        .limit(1);
      share = s;
    } catch (err) {
      logger.error({ err }, "[guest-meet-token] Database error fetching share");
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }

    if (!share) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    // ─── Verification 2: Check expiration ───────────────────────────────────

    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    // ─── Verification 3: Load document ──────────────────────────────────────

    let doc;
    try {
      const [d] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, share.documentId))
        .limit(1);
      doc = d;
    } catch (err) {
      logger.error({ err }, "[guest-meet-token] Database error fetching document");
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }

    if (!doc) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    // ─── Verification 4: Load space & check classification ──────────────────

    let space;
    try {
      const [s] = await db
        .select()
        .from(spaces)
        .where(eq(spaces.id, doc.spaceId))
        .limit(1);
      space = s;
    } catch (err) {
      logger.error({ err }, "[guest-meet-token] Database error fetching space");
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }

    if (!space) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    if (doc.classification !== "public" || space.classification !== "public") {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    // ─── Verification 5: Find meeting by roomName & documentId ──────────────

    let meeting;
    try {
      const [m] = await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.roomName, roomName),
            eq(meetings.documentId, doc.id)
          )
        )
        .limit(1);
      meeting = m;
    } catch (err) {
      logger.error({ err }, "[guest-meet-token] Database error fetching meeting");
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }

    if (!meeting) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    // ─── Verification 6: Check meeting status ───────────────────────────────

    const endedStatuses = ["ended", "completed", "failed"];
    if (endedStatuses.includes(meeting.status)) {
      return NextResponse.json(
        { error: "La réunion est terminée" },
        { status: 409 }
      );
    }

    // ─── Verification 7: Check LiveKit credentials ──────────────────────────

    const lkConfig = await getLiveKitConfig();
    const apiKey = lkConfig.livekitApiKey;
    const apiSecret = lkConfig.livekitApiSecret;

    if (!apiKey || !apiSecret) {
      logger.error("[guest-meet-token] LiveKit credentials not configured");
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }

    // ─── Generate LiveKit token ────────────────────────────────────────────

    try {
      const guestUserId = `guest_${randomUUID()}`;
      const token = await generateLiveKitToken({
        roomName,
        userId: guestUserId,
        userName: sanitizedDisplayName,
        userEmail: "",
        ttl: "1h",
      });

      logger.debug(
        { guestUserId, roomName, displayName: sanitizedDisplayName },
        "[guest-meet-token] Token generated successfully"
      );

      return NextResponse.json({ token }, { status: 200 });
    } catch (err) {
      logger.error(
        { err, roomName },
        "[guest-meet-token] Token generation failed"
      );
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503 }
      );
    }
  } catch (err) {
    logger.error({ err }, "[guest-meet-token] Unexpected error");
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
}
