import { and, count, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  aiCreationProposals,
  type AiCreationKind,
} from "@/lib/db/schema-ai-creation-proposals";

export const CREATION_PROPOSAL_TTL_MS = 86_400_000;
/** Une proposition `applying` depuis plus longtemps est reprise (processus mort en cours d'application). */
export const CREATION_STALE_APPLYING_MS = 10 * 60 * 1000;

export type CreationProposalRow = typeof aiCreationProposals.$inferSelect;

export async function createCreationProposal(input: {
  orgId: string;
  userId: string;
  spaceId?: string | null;
  kind: AiCreationKind;
  payload: unknown;
  now?: Date;
}): Promise<CreationProposalRow> {
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(aiCreationProposals)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      spaceId: input.spaceId ?? null,
      kind: input.kind,
      payload: input.payload,
      expiresAt: new Date(now.getTime() + CREATION_PROPOSAL_TTL_MS),
    })
    .returning();
  return row;
}

/**
 * Lecture par (organisation, propriétaire, id) : null pour tout autre utilisateur ou
 * organisation, et null pour une proposition `pending` échue (non applicable).
 */
export async function getOwnCreationProposal(
  orgId: string,
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<CreationProposalRow | null> {
  const [row] = await db
    .select()
    .from(aiCreationProposals)
    .where(
      and(
        eq(aiCreationProposals.id, id),
        eq(aiCreationProposals.orgId, orgId),
        eq(aiCreationProposals.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.status === "pending" && row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

/**
 * Transition atomique vers `applying` : depuis `pending` non échue, ou depuis un `applying` abandonné
 * depuis plus de 10 minutes et sans objet enregistré (`result_id` nul, sinon un doublon serait créé).
 * `applied_at` sert d'horodatage de prise ; `markApplied` le réécrit. False si déjà prise ou échue.
 */
export async function claimForApply(id: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(aiCreationProposals)
    .set({ status: "applying", appliedAt: now })
    .where(
      and(
        eq(aiCreationProposals.id, id),
        or(
          and(eq(aiCreationProposals.status, "pending"), gt(aiCreationProposals.expiresAt, now)),
          and(
            eq(aiCreationProposals.status, "applying"),
            isNull(aiCreationProposals.resultId),
            lt(aiCreationProposals.appliedAt, new Date(now.getTime() - CREATION_STALE_APPLYING_MS)),
          ),
        ),
      ),
    )
    .returning({ id: aiCreationProposals.id });
  return rows.length > 0;
}

/** Propositions `pending` non échues d'un utilisateur dans une organisation. */
export async function countPendingCreationProposals(
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(aiCreationProposals)
    .where(
      and(
        eq(aiCreationProposals.orgId, orgId),
        eq(aiCreationProposals.userId, userId),
        eq(aiCreationProposals.status, "pending"),
        gt(aiCreationProposals.expiresAt, now),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function markApplied(id: string, resultId: string, resultType?: string): Promise<void> {
  await db
    .update(aiCreationProposals)
    .set({ status: "applied", resultId, resultType: resultType ?? null, appliedAt: new Date() })
    .where(and(eq(aiCreationProposals.id, id), eq(aiCreationProposals.status, "applying")));
}

export async function markFailed(id: string): Promise<void> {
  await db
    .update(aiCreationProposals)
    .set({ status: "failed" })
    .where(and(eq(aiCreationProposals.id, id), eq(aiCreationProposals.status, "applying")));
}

/** False si rien n'a été mis à jour (la proposition n'était plus `pending`). */
export async function markDismissed(id: string): Promise<boolean> {
  const rows = await db
    .update(aiCreationProposals)
    .set({ status: "dismissed" })
    .where(and(eq(aiCreationProposals.id, id), eq(aiCreationProposals.status, "pending")))
    .returning({ id: aiCreationProposals.id });
  return rows.length > 0;
}

/** Après suppression de l'objet créé : applied vers undone. False si la proposition n'était plus `applied`. */
export async function markUndone(id: string, orgId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(aiCreationProposals)
    .set({ status: "undone" })
    .where(
      and(
        eq(aiCreationProposals.id, id),
        eq(aiCreationProposals.orgId, orgId),
        eq(aiCreationProposals.userId, userId),
        eq(aiCreationProposals.status, "applied"),
      ),
    )
    .returning({ id: aiCreationProposals.id });
  return rows.length > 0;
}

/** Rétablit une proposition ignorée : dismissed vers pending, seulement si elle n'est pas échue. */
export async function markRestored(
  id: string,
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(aiCreationProposals)
    .set({ status: "pending" })
    .where(
      and(
        eq(aiCreationProposals.id, id),
        eq(aiCreationProposals.orgId, orgId),
        eq(aiCreationProposals.userId, userId),
        eq(aiCreationProposals.status, "dismissed"),
        gt(aiCreationProposals.expiresAt, now),
      ),
    )
    .returning({ id: aiCreationProposals.id });
  return rows.length > 0;
}

/** Journalise les modifications de l'utilisateur à l'application ; le payload stocké reste inchangé. */
export async function recordOverrides(id: string, overrides: unknown): Promise<void> {
  await db.update(aiCreationProposals).set({ overrides }).where(eq(aiCreationProposals.id, id));
}
