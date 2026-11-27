import { createHash, randomBytes } from "crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailVerificationTokens, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { isEmailConfigured } from "@/lib/email/email-configured";
import { emailVerificationEmail } from "@/lib/email/templates/email-verification";
import logger from "@/lib/logger";

export const VERIFICATION_TTL_MS = 86_400_000;
export const RESEND_COOLDOWN_MS = 60_000;

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConsumeResult =
  | { status: "verified"; userId: string }
  | { status: "expired" | "used" | "invalid" };

export type SendVerificationResult = {
  sent: boolean;
  reason?: "cooldown" | "not_configured" | "send_failed";
};

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Replaces any unused token of the account, stores only the hash. */
export async function createVerificationToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await db
    .delete(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        isNull(emailVerificationTokens.usedAt),
      ),
    );
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
  });
  return raw;
}

/**
 * Atomic single-use consumption: the conditional UPDATE ... RETURNING lets
 * only one concurrent caller claim the token.
 */
export async function consumeVerificationToken(
  raw: string,
): Promise<ConsumeResult> {
  const tokenHash = hashToken(raw);
  const now = new Date();

  const userId = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, now),
        ),
      )
      .returning({ userId: emailVerificationTokens.userId });
    if (claimed.length === 0) return null;
    await tx
      .update(users)
      .set({ emailVerifiedAt: now })
      .where(eq(users.id, claimed[0].userId));
    return claimed[0].userId;
  });
  if (userId) return { status: "verified", userId };

  const [row] = await db
    .select({
      usedAt: emailVerificationTokens.usedAt,
      expiresAt: emailVerificationTokens.expiresAt,
    })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) return { status: "invalid" };
  if (row.usedAt) return { status: "used" };
  return { status: "expired" };
}

/** Any token state, used to resend from an expired link. */
export async function findUserIdByToken(raw: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: emailVerificationTokens.userId })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, hashToken(raw)))
    .limit(1);
  return row?.userId ?? null;
}

export async function sendVerificationEmail(user: {
  id: string;
  name: string;
  email: string;
}): Promise<SendVerificationResult> {
  if (!(await isEmailConfigured())) {
    return { sent: false, reason: "not_configured" };
  }

  const [last] = await db
    .select({ createdAt: emailVerificationTokens.createdAt })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, user.id))
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { sent: false, reason: "cooldown" };
  }

  const raw = await createVerificationToken(user.id);
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const tpl = emailVerificationEmail({
    userName: user.name,
    verifyUrl: `${baseUrl}/verify-email?token=${raw}`,
    expiresInHours: VERIFICATION_TTL_MS / 3_600_000,
  });

  try {
    const result = await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    if (!result.success) {
      logger.warn(
        "[email-verification] Envoi échoué pour %s: %s",
        user.id,
        result.error ?? "inconnu",
      );
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (err) {
    logger.warn(
      "[email-verification] Envoi échoué pour %s: %s",
      user.id,
      err instanceof Error ? err.message : "inconnu",
    );
    return { sent: false, reason: "send_failed" };
  }
}

export async function markEmailVerified(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Inside the caller's transaction: a successful password reset proves mailbox
 * ownership. An already set date is never overwritten.
 */
export async function markVerifiedAfterPasswordReset(
  tx: DbTransaction,
  userId: string,
): Promise<void> {
  const now = new Date();
  await tx
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  await tx
    .update(emailVerificationTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        isNull(emailVerificationTokens.usedAt),
      ),
    );
}
