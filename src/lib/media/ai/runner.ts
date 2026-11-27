import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import logger from "@/lib/logger";
import { getFileBuffer } from "@/lib/storage/s3";
import { getMediaAiSettings } from "./settings";
import { enqueueMediaIndex } from "./enqueue";
import { extractableKind, extractText } from "./extract";
import { transcribeMedia } from "./transcribe";
import { writeMediaIndex } from "./index-media";
import {
  MAX_ATTEMPTS,
  MAX_EXTRACT_BYTES,
  MAX_TRANSCRIBE_SECONDS,
  ORG_DAILY_MEDIA_MAX,
  ORG_DAILY_TRANSCRIBE_MINUTES,
  RETRY_DELAYS_MS,
} from "./limits";

const log = logger.child({ module: "media-ai-runner" });

/** Une tâche `running` dont le `locked_at` est plus vieux que ceci est rendue à la file (plantage du process). */
export const STALE_LOCK_MS = 15 * 60_000;
const NO_ENGINE_DELAY_MS = 10 * 60_000;
const QUOTA_DELAY_MS = 60 * 60_000;
const AI_QUOTA_DELAY_MS = 60 * 60_000;

export type ClaimedRow = {
  id: string;
  mediaId: string;
  organizationId: string;
  version: number;
  /** Échecs déjà comptés (une reprise après plantage compte pour un échec). */
  attempts: number;
};

export type ProcessOutcome = "done" | "skipped" | "retry" | "failed";

/**
 * Prend jusqu'à `limit` tâches. `FOR UPDATE SKIP LOCKED` : deux exécuteurs concurrents ne
 * reçoivent jamais la même ligne. Reprend les `running` figées (compteur d'essais incrémenté,
 * pour qu'un fichier qui fait planter le process finisse en `failed`). Ne prend que les
 * organisations qui ont l'indexation activée et les médias hors corbeille : les autres lignes
 * restent `pending` (relues à l'activation, ou à la restauration depuis la corbeille).
 */
export async function claimBatch(limit: number, now: Date): Promise<ClaimedRow[]> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const res = await db.execute(sql`
    UPDATE media_texts SET
      attempts = CASE WHEN status = 'running' THEN attempts + 1 ELSE attempts END,
      status = 'running', locked_at = ${now}, updated_at = ${now}
    WHERE id IN (
      SELECT mt.id FROM media_texts mt
      WHERE ((mt.status = 'pending' AND mt.next_attempt_at <= ${now})
          OR (mt.status = 'running' AND mt.locked_at < ${staleBefore}))
        AND EXISTS (SELECT 1 FROM media_ai_settings s WHERE s.organization_id = mt.organization_id AND s.index_enabled)
        AND EXISTS (SELECT 1 FROM media m WHERE m.id = mt.media_id AND m.deleted_at IS NULL)
      ORDER BY mt.next_attempt_at
      LIMIT ${limit}
      FOR UPDATE OF mt SKIP LOCKED
    )
    RETURNING id, media_id, organization_id, version, attempts`);
  return (res.rows as Array<{ id: string; media_id: string; organization_id: string; version: number; attempts: number }>).map(
    (r) => ({
      id: r.id,
      mediaId: r.media_id,
      organizationId: r.organization_id,
      version: r.version,
      attempts: r.attempts,
    }),
  );
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const startOfDay = (now: Date) => new Date(`${dayOf(now)}T00:00:00.000Z`);

/** Secondes de transcription encore disponibles aujourd'hui (UTC) pour l'organisation. */
export async function remainingTranscribeSeconds(orgId: string, now: Date): Promise<number> {
  const res = await db.execute(
    sql`SELECT transcribe_seconds FROM media_ai_daily_usage WHERE organization_id = ${orgId} AND day = ${dayOf(now)}`,
  );
  const used = Number((res.rows as Array<{ transcribe_seconds: number }>)[0]?.transcribe_seconds ?? 0);
  return Math.max(0, ORG_DAILY_TRANSCRIBE_MINUTES * 60 - used);
}

/**
 * Réserve de façon atomique des secondes de transcription (au plus `MAX_TRANSCRIBE_SECONDS`, au plus
 * ce qui reste du plafond du jour) et rend le nombre réservé (0 : plafond atteint). Deux traitements
 * parallèles ne peuvent donc pas consommer chacun le plafond entier ; la durée réelle régularise ensuite.
 */
export async function reserveTranscribeSeconds(orgId: string, now: Date): Promise<number> {
  const cap = ORG_DAILY_TRANSCRIBE_MINUTES * 60;
  await db.execute(
    sql`INSERT INTO media_ai_daily_usage (organization_id, day, updated_at)
        VALUES (${orgId}, ${dayOf(now)}, ${now}) ON CONFLICT (organization_id, day) DO NOTHING`,
  );
  const res = await db.execute(
    sql`WITH cur AS (
          SELECT organization_id, day, transcribe_seconds FROM media_ai_daily_usage
          WHERE organization_id = ${orgId} AND day = ${dayOf(now)} FOR UPDATE
        )
        UPDATE media_ai_daily_usage u
        SET transcribe_seconds = u.transcribe_seconds + LEAST(${MAX_TRANSCRIBE_SECONDS}, GREATEST(0, ${cap} - cur.transcribe_seconds)),
            updated_at = ${now}
        FROM cur WHERE u.organization_id = cur.organization_id AND u.day = cur.day
        RETURNING LEAST(${MAX_TRANSCRIBE_SECONDS}, GREATEST(0, ${cap} - cur.transcribe_seconds)) AS reserved`,
  );
  return Number((res.rows as Array<{ reserved: number }>)[0]?.reserved ?? 0);
}

/** Ajoute (ou retire, si négatif) des secondes au compteur du jour, sans passer sous zéro. */
async function adjustTranscribeSeconds(orgId: string, delta: number, now: Date): Promise<void> {
  const d = Math.trunc(delta);
  if (d === 0) return;
  await db.execute(
    sql`UPDATE media_ai_daily_usage SET transcribe_seconds = GREATEST(0, transcribe_seconds + ${d}), updated_at = ${now}
        WHERE organization_id = ${orgId} AND day = ${dayOf(now)}`,
  );
}

/** Passages d'indexation déjà comptés aujourd'hui (UTC) pour l'organisation. */
export async function indexedToday(orgId: string, now: Date): Promise<number> {
  const res = await db.execute(
    sql`SELECT indexed_passes FROM media_ai_daily_usage WHERE organization_id = ${orgId} AND day = ${dayOf(now)}`,
  );
  return Number((res.rows as Array<{ indexed_passes: number }>)[0]?.indexed_passes ?? 0);
}

/**
 * Réserve un passage (extraction + embeddings) de façon atomique : refusé une fois le plafond du
 * jour atteint. Chaque passage compte, y compris un `/reindex` répété sur le même média.
 */
export async function reservePass(orgId: string, now: Date): Promise<boolean> {
  const res = await db.execute(
    sql`INSERT INTO media_ai_daily_usage (organization_id, day, indexed_passes, updated_at)
        VALUES (${orgId}, ${dayOf(now)}, 1, ${now})
        ON CONFLICT (organization_id, day)
        DO UPDATE SET indexed_passes = media_ai_daily_usage.indexed_passes + 1, updated_at = ${now}
        WHERE media_ai_daily_usage.indexed_passes < ${ORG_DAILY_MEDIA_MAX}
        RETURNING indexed_passes`,
  );
  return res.rows.length > 0;
}

/** Toutes les écritures d'état sont gardées par `status = 'running'` et `version` : une mise en file concurrente l'emporte. */
async function settle(
  row: ClaimedRow,
  next: { status: "pending" | "skipped" | "failed"; reason: string; delayMs?: number; attemptsPlus?: number },
  now: Date,
): Promise<void> {
  const at = new Date(now.getTime() + (next.delayMs ?? 0));
  await db.execute(
    sql`UPDATE media_texts SET status = ${next.status}, reason = ${next.reason.slice(0, 32)},
          attempts = attempts + ${next.attemptsPlus ?? 0},
          next_attempt_at = ${at}, locked_at = NULL, updated_at = ${now}
        WHERE id = ${row.id} AND status = 'running' AND version = ${row.version}`,
  );
}

/** Échec d'extraction ou d'écriture : un essai de plus ; au 3e, `failed` ; sinon attente croissante. */
async function failAttempt(row: ClaimedRow, reason: string, now: Date): Promise<ProcessOutcome> {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await settle(row, { status: "failed", reason, attemptsPlus: 1 }, now);
    return "failed";
  }
  await settle(
    row,
    { status: "pending", reason, attemptsPlus: 1, delayMs: RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)] },
    now,
  );
  return "retry";
}

/** Cause transitoire : on repousse sans consommer d'essai. */
async function later(row: ClaimedRow, reason: string, delayMs: number, now: Date): Promise<ProcessOutcome> {
  await settle(row, { status: "pending", reason, delayMs }, now);
  return "retry";
}

async function skip(row: ClaimedRow, reason: string, now: Date): Promise<ProcessOutcome> {
  await settle(row, { status: "skipped", reason }, now);
  return "skipped";
}

/**
 * Traite une tâche prise. Relit le média et les interrupteurs de l'organisation au moment du
 * traitement (jamais la copie de la file). Ne lève jamais.
 */
export async function processOne(row: ClaimedRow, now: Date): Promise<ProcessOutcome> {
  try {
    if (row.attempts >= MAX_ATTEMPTS) {
      await settle(row, { status: "failed", reason: "crashed" }, now);
      return "failed";
    }

    const [m] = await db
      .select({
        id: media.id,
        organizationId: media.organizationId,
        storageKey: media.storageKey,
        sizeBytes: media.sizeBytes,
        mimeType: media.mimeType,
        filename: media.filename,
        kind: media.kind,
        uploadedBy: media.uploadedBy,
        currentVersion: media.currentVersion,
        deletedAt: media.deletedAt,
      })
      .from(media)
      .where(eq(media.id, row.mediaId))
      .limit(1);

    // Disparu (la ligne de file part en cascade) ou organisation incohérente : rien à écrire.
    if (!m || m.organizationId !== row.organizationId) return "skipped";
    // Corbeille : la ligne reste pending, reprise à la restauration.
    if (m.deletedAt) return await later(row, "trashed", QUOTA_DELAY_MS, now);
    // Version courante différente de celle de la tâche : on réaligne la ligne (texte et vecteurs périmés effacés).
    if (m.currentVersion !== row.version) {
      await enqueueMediaIndex(row.mediaId, "replace");
      return "retry";
    }

    const settings = await getMediaAiSettings(row.organizationId);
    if (!settings.indexEnabled) return await later(row, "disabled", QUOTA_DELAY_MS, now);

    const format = extractableKind(m.mimeType, m.filename);
    if (!format) return await skip(row, "unsupported", now);

    let text: string;
    let source: Exclude<typeof format, null>;
    let truncated = false;

    if (format === "transcript") {
      if (!settings.transcribeEnabled) return await skip(row, "disabled", now);
      if (m.kind !== "audio" && m.kind !== "video") return await skip(row, "unsupported", now);
      const reserved = await reserveTranscribeSeconds(row.organizationId, now);
      if (reserved <= 0) return await later(row, "daily_quota", QUOTA_DELAY_MS, now);
      let t: Awaited<ReturnType<typeof transcribeMedia>>;
      try {
        t = await transcribeMedia({
          orgId: row.organizationId,
          mediaId: m.id,
          storageKey: m.storageKey,
          sizeBytes: Number(m.sizeBytes),
          mimeType: m.mimeType,
          kind: m.kind,
          remainingDailySeconds: reserved,
        });
      } catch (err) {
        await adjustTranscribeSeconds(row.organizationId, -reserved, now);
        throw err;
      }
      // Régularisation : la durée réelle remplace la réservation (remboursée en entier sans transcription).
      await adjustTranscribeSeconds(row.organizationId, (t.ok ? Math.ceil(t.seconds) : 0) - reserved, now);
      if (!t.ok) {
        if (t.reason === "no_engine") return await later(row, "no_engine", NO_ENGINE_DELAY_MS, now);
        if (t.reason === "quota") return await later(row, "daily_quota", QUOTA_DELAY_MS, now);
        if (t.reason === "disabled") return await skip(row, "disabled", now);
        if (t.reason === "error") return await failAttempt(row, "transcribe_error", now);
        return await skip(row, t.reason, now); // too_large, too_long, no_audio, empty : définitifs
      }
      text = t.text;
      source = "transcript";
      truncated = t.truncated;
    } else {
      if (Number(m.sizeBytes) > MAX_EXTRACT_BYTES) return await skip(row, "too_large", now);
      if (!(await reservePass(row.organizationId, now))) {
        return await later(row, "daily_quota", QUOTA_DELAY_MS, now);
      }
      const buffer = await getFileBuffer(m.storageKey);
      if (!buffer) return await failAttempt(row, "object_missing", now);
      const x = await extractText({ buffer, mimeType: m.mimeType, filename: m.filename });
      if (!x.ok) {
        if (x.reason === "error") return await failAttempt(row, "extract_error", now);
        return await skip(row, x.reason, now); // unsupported, too_large, empty
      }
      text = x.text;
      source = x.source;
      truncated = x.truncated;
    }

    const w = await writeMediaIndex({
      mediaId: m.id,
      organizationId: row.organizationId,
      uploadedBy: m.uploadedBy,
      text,
      version: row.version,
      source,
    });
    if (!w.ok) {
      if (w.reason === "quota") return await later(row, "ai_quota", AI_QUOTA_DELAY_MS, now);
      if (w.reason === "no_embedding") return await later(row, "no_embedding", NO_ENGINE_DELAY_MS, now);
      if (w.reason === "stale") return "retry"; // remplacé ou mis en corbeille pendant le calcul : la mise en file l'a déjà remis à pending
      return await failAttempt(row, "index_error", now);
    }

    await db.execute(
      sql`UPDATE media_texts SET status = 'done', reason = NULL, source = ${source}, text = ${text},
            text_chars = ${text.length}, truncated = ${truncated}, indexed_at = ${now},
            locked_at = NULL, updated_at = ${now}
          WHERE id = ${row.id} AND status = 'running' AND version = ${row.version}`,
    );
    return "done";
  } catch (err) {
    log.warn({ mediaId: row.mediaId, err: String(err) }, "Traitement d'indexation IA en erreur");
    try {
      return await failAttempt(row, "unexpected", now);
    } catch {
      return "failed";
    }
  }
}
