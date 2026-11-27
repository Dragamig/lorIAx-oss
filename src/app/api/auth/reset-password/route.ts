import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, passwordResetTokens } from "@/lib/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { checkRateLimitAsync, RATE_LIMITS, getClientIpOrNull } from "@/lib/rate-limit";
import { z } from "zod";
import { createHash } from "crypto";
import { revokeUserApiKeys, revokeUserSessions } from "@/lib/auth/revoke-sessions";
import logger from "@/lib/logger";
import { markVerifiedAfterPasswordReset } from "@/lib/auth/email-verification";

const schema = z.object({
  token: z.string().min(1, "Token requis"),
  password: z.string().min(8, "Le mot de passe doit faire au moins 8 caractères"),
});

export async function POST(request: Request) {
  // AZ-26 : compteur PARTAGÉ. AZ-25 : sans adresse déterminable, le palier par
  // IP est sauté plutôt qu'indexé sur une constante partagée par tous, ce qui
  // aurait rendu la réinitialisation inaccessible à tout le monde. Le palier par
  // jeton, appliqué plus bas, couvre le cas et est de toute façon la dimension
  // pertinente ici : c'est le jeton qu'on bruteforce, pas l'adresse.
  const ip = getClientIpOrNull(request);
  if (ip) {
    const rateLimitResult = await checkRateLimitAsync(
      `reset-password:${ip}`,
      RATE_LIMITS.auth
    );
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez plus tard." },
        { status: 429 }
      );
    }
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { token, password } = parsed.data;

    // Palier par jeton : toujours actif, y compris sans adresse exploitable.
    const tokenRateLimit = await checkRateLimitAsync(
      `reset-password:token:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`,
      RATE_LIMITS.auth
    );
    if (!tokenRateLimit.success) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez plus tard." },
        { status: 429 }
      );
    }

    // Find valid, unused, non-expired token
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!resetToken) {
      return NextResponse.json(
        { error: "Lien invalide ou expiré. Veuillez refaire une demande." },
        { status: 400 }
      );
    }

    // Hash new password and update user
    const passwordHash = await bcrypt.hash(password, 12);

    // One transaction: password change, token consumption and proof of mailbox
    // ownership succeed or fail together.
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        // AZ-05 : `tokenInvalidatedAt` révoque les sessions ouvertes avant le
        // changement de mot de passe, comme le fait déjà `force-reset-password`.
        // Sans lui, un cookie volé survivait 24 h à la réinitialisation.
        .set({
          passwordHash,
          mustResetPassword: false,
          tokenInvalidatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, resetToken.userId));

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetToken.id));

      await markVerifiedAfterPasswordReset(tx, resetToken.userId);
    });
    await revokeUserSessions(resetToken.userId);
    // Un mot de passe réinitialisé suppose un compte potentiellement compromis :
    // les clés d'API lrx_ ne doivent pas lui survivre.
    await revokeUserApiKeys(resetToken.userId);

    return NextResponse.json({
      message: "Mot de passe réinitialisé avec succès.",
    });
  } catch (error) {
    logger.error({ err: error }, "[reset-password] Erreur réinitialisation mot de passe");
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
