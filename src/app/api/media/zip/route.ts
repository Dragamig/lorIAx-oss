import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { logActivity } from "@/lib/activity";
import { UUID_RE } from "@/lib/media/folders-http";
import { BATCH_MAX_IDS } from "@/lib/media/batch";
import { buildContentDisposition } from "@/lib/media/content-disposition";
import { planZip, streamZip } from "@/lib/media/zip";
import { RATE_LIMITS, consumeQuota, isQuotaExceeded, peekQuotaExceeded, resetQuota } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Créneau « une archive à la fois par utilisateur », porté par le compteur partagé de rate-limit
 * (Redis si REDIS_URL, mémoire sinon) : valable en multi-instance. Un jeton par fenêtre,
 * libéré par resetQuota ; la fenêtre sert de garde-fou si une instance meurt en cours d'archive.
 */
const SLOT_TIERS = [{ maxRequests: 1, windowMs: 30 * 60 * 1000 }] as const;
const slotKey = (userId: string) => `media-zip-slot:${userId}`;

function parseSource(sp: URLSearchParams): { ids: string[] } | { folderId: string } | null {
  const rawIds = sp.get("ids");
  const folderId = sp.get("folderId");
  if (rawIds !== null && folderId !== null) return null;
  if (folderId !== null) return UUID_RE.test(folderId) ? { folderId } : null;
  if (rawIds === null) return null;
  const ids = rawIds.split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > BATCH_MAX_IDS) return null;
  if (!ids.every((i) => UUID_RE.test(i))) return null;
  return { ids };
}

function tooMany(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const source = parseSource(sp);
  if (!source) {
    return NextResponse.json(
      { error: `Paramètre ids (${BATCH_MAX_IDS} au plus) ou folderId requis` },
      { status: 400 },
    );
  }
  const probe = sp.get("probe") === "1";
  const quotaKey = `media-zip:${user.id}`;
  const tiers = [RATE_LIMITS.mediaZip] as const;
  const retryAfter = Math.ceil(RATE_LIMITS.mediaZip.windowMs / 1000);

  // Une archive à la fois : le sondage ne fait que lire, le téléchargement prend le jeton (atomique).
  const busy = probe
    ? await peekQuotaExceeded(slotKey(user.id), SLOT_TIERS)
    : await isQuotaExceeded(slotKey(user.id), SLOT_TIERS);
  if (busy) return tooMany("Archive déjà en cours", 30);
  let released = probe;
  const acquiredAt = Date.now();
  const release = () => {
    if (released) return;
    released = true;
    // Créneau déjà expiré : il a pu être repris par une autre archive du même utilisateur, ne pas le libérer.
    if (Date.now() - acquiredAt >= SLOT_TIERS[0].windowMs) return;
    void resetQuota(slotKey(user.id), SLOT_TIERS);
  };

  try {
    if (await peekQuotaExceeded(quotaKey, tiers)) {
      release();
      return tooMany("Trop d'archives récentes, réessayez plus tard", retryAfter);
    }

    if (probe && (await isQuotaExceeded(`media-zip-probe:${user.id}`, [RATE_LIMITS.mediaZipProbe]))) {
      return tooMany("Trop de vérifications, réessayez dans un instant", 60);
    }

    const plan = await planZip(user, orgId, source);
    if (!plan.ok) {
      release();
      return NextResponse.json(
        { error: plan.error },
        { status: plan.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (probe) {
      return new NextResponse(null, {
        status: 204,
        headers: { "X-Zip-Skipped": String(plan.skipped), "Cache-Control": "no-store" },
      });
    }

    await consumeQuota(quotaKey, tiers);

    const stream = streamZip(plan, req.signal);
    stream.once("close", release);
    stream.once("error", release);
    if (req.signal.aborted) stream.destroy();

    void logActivity({
      userId: user.id,
      action: "download",
      entityType: "media",
      entityId: plan.entries[0].mediaId,
      metadata: {
        count: plan.entries.length,
        skipped: plan.skipped,
        bytes: plan.totalBytes,
        ...("folderId" in source ? { folderId: source.folderId } : {}),
      },
    });

    const base =
      "folderId" in source
        ? (plan.entries[0].path.split("/")[0] ?? "mediatheque")
        : `mediatheque-${new Date().toISOString().slice(0, 10)}`;
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": buildContentDisposition(`${base}.zip`, false),
        "X-Zip-Skipped": String(plan.skipped),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    release();
    throw e;
  }
}
