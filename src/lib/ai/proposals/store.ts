import { randomUUID } from "crypto";
import { and, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiProposals, type AiProposalRow } from "@/lib/db/schema-ai-proposals";
import { CLOSED_RETENTION_DAYS, PROPOSAL_TTL_MS } from "@/lib/ai/chat-tools/limits";
import type { ChatToolContext } from "@/lib/ai/chat-tools/context";
import type { Freshness, ProposalPayload } from "./types";

/** Au-delà, une proposition restée `applying` est considérée comme échouée (crash en cours d'application). */
export const APPLYING_ORPHAN_MS = 10 * 60 * 1000;
export const APPLYING_ORPHAN_MESSAGE = "Application interrompue, aucune modification n'a été confirmée";

const CLOSED_STATUSES = ["applied", "dismissed", "stale", "undone", "expired", "failed"] as const;

export async function createProposal(input: {
  ctx: ChatToolContext;
  databaseId: string;
  payload: ProposalPayload;
  freshness: Freshness;
  replacesId?: string;
}): Promise<AiProposalRow> {
  const now = Date.now();
  const [row] = await db
    .insert(aiProposals)
    .values({
      orgId: input.ctx.orgId,
      userId: input.ctx.user.id,
      databaseId: input.databaseId,
      type: input.payload.type,
      payload: input.payload,
      freshness: input.freshness,
      batchId: randomUUID(),
      replacesId: input.replacesId ?? null,
      expiresAt: new Date(now + PROPOSAL_TTL_MS),
    })
    .returning();
  return row;
}

/** Passe une proposition `pending` échue à `expired` (gardé par le statut : jamais d'écrasement d'un autre état). */
export async function markExpiredIfDue(row: AiProposalRow, now: Date = new Date()): Promise<AiProposalRow> {
  if (row.status !== "pending" || row.expiresAt.getTime() > now.getTime()) return row;
  await db
    .update(aiProposals)
    .set({ status: "expired" })
    .where(and(eq(aiProposals.id, row.id), eq(aiProposals.status, "pending")));
  return { ...row, status: "expired" };
}

/**
 * Une proposition `applying` dont l'application a démarré (appliedAt posé au claim) il y a plus de
 * APPLYING_ORPHAN_MS passe à `failed`.
 */
export async function failOrphanApplying(row: AiProposalRow, now: Date = new Date()): Promise<AiProposalRow> {
  if (row.status !== "applying") return row;
  const startedAt = row.appliedAt ?? row.createdAt;
  if (now.getTime() - startedAt.getTime() <= APPLYING_ORPHAN_MS) return row;
  await db
    .update(aiProposals)
    .set({ status: "failed", failureMessage: APPLYING_ORPHAN_MESSAGE })
    .where(and(eq(aiProposals.id, row.id), eq(aiProposals.status, "applying")));
  return { ...row, status: "failed", failureMessage: APPLYING_ORPHAN_MESSAGE };
}

/** Lecture par (id, userId, orgId) : null pour tout autre utilisateur ou organisation. */
export async function getOwnProposal(args: {
  id: string;
  userId: string;
  orgId: string;
  now?: Date;
}): Promise<AiProposalRow | null> {
  const [row] = await db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.id, args.id), eq(aiProposals.userId, args.userId), eq(aiProposals.orgId, args.orgId)))
    .limit(1);
  if (!row) return null;
  const now = args.now ?? new Date();
  return failOrphanApplying(await markExpiredIfDue(row, now), now);
}

/**
 * Transition atomique `pending` vers `applying` (garde contre le double clic), pose appliedAt = début
 * de la tentative (référence de la reprise des `applying` orphelins). Null si déjà prise, échue ou non possédée.
 */
export async function claimForApply(args: {
  id: string;
  userId: string;
  orgId: string;
  now?: Date;
}): Promise<AiProposalRow | null> {
  const now = args.now ?? new Date();
  const [row] = await db
    .update(aiProposals)
    .set({ status: "applying", appliedAt: now })
    .where(
      and(
        eq(aiProposals.id, args.id),
        eq(aiProposals.userId, args.userId),
        eq(aiProposals.orgId, args.orgId),
        eq(aiProposals.status, "pending"),
        gt(aiProposals.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}

/** Propositions `pending` non échues de l'utilisateur dans l'organisation (les `applying` orphelines sont reprises au passage). */
export async function listPendingProposals(args: {
  userId: string;
  orgId: string;
  now?: Date;
}): Promise<AiProposalRow[]> {
  const now = args.now ?? new Date();
  const own = and(eq(aiProposals.userId, args.userId), eq(aiProposals.orgId, args.orgId));
  const applying = await db
    .select()
    .from(aiProposals)
    .where(and(own, eq(aiProposals.status, "applying")));
  for (const r of applying) await failOrphanApplying(r, now);
  return db
    .select()
    .from(aiProposals)
    .where(and(own, eq(aiProposals.status, "pending"), gt(aiProposals.expiresAt, now)))
    .orderBy(desc(aiProposals.createdAt));
}

/** Propositions `pending`, `stale` ou `failed` non échues (moins de 24 h) de l'utilisateur dans l'organisation. */
export async function listOpenProposals(args: {
  userId: string;
  orgId: string;
  now?: Date;
}): Promise<AiProposalRow[]> {
  const now = args.now ?? new Date();
  const own = and(eq(aiProposals.userId, args.userId), eq(aiProposals.orgId, args.orgId));
  const applying = await db
    .select()
    .from(aiProposals)
    .where(and(own, eq(aiProposals.status, "applying")));
  for (const r of applying) await failOrphanApplying(r, now);
  return db
    .select()
    .from(aiProposals)
    .where(and(own, inArray(aiProposals.status, ["pending", "stale", "failed"]), gt(aiProposals.expiresAt, now)))
    .orderBy(desc(aiProposals.createdAt));
}

/**
 * Supprime les propositions closes depuis plus de CLOSED_RETENTION_DAYS (date de clôture = dernière de
 * undone/dismissed/applied, à défaut expiresAt). Ne touche jamais `pending` ni `applying`.
 */
export async function purgeClosedProposals(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CLOSED_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .delete(aiProposals)
    .where(
      and(
        inArray(aiProposals.status, [...CLOSED_STATUSES]),
        lt(sql`coalesce(${aiProposals.undoneAt}, ${aiProposals.dismissedAt}, ${aiProposals.appliedAt}, ${aiProposals.expiresAt})`, cutoff),
      ),
    )
    .returning({ id: aiProposals.id });
  return rows.length;
}

/** Transition atomique `pending` vers `dismissed`. Null si la proposition n'est pas en attente ou n'est pas possédée. */
export async function dismissProposal(args: {
  id: string;
  userId: string;
  orgId: string;
  now?: Date;
}): Promise<AiProposalRow | null> {
  const now = args.now ?? new Date();
  const [row] = await db
    .update(aiProposals)
    .set({ status: "dismissed", dismissedAt: now })
    .where(
      and(
        eq(aiProposals.id, args.id),
        eq(aiProposals.userId, args.userId),
        eq(aiProposals.orgId, args.orgId),
        // `failed` reste ignorable sans condition de durée : la carte n'a pas d'autre issue.
        or(and(eq(aiProposals.status, "pending"), gt(aiProposals.expiresAt, now)), eq(aiProposals.status, "failed")),
      ),
    )
    .returning();
  return row ?? null;
}
