import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { passwordResetTokens } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { passwordResetEmail } from "@/lib/email/templates/password-reset";

export const RESET_TOKEN_EXPIRY_MINUTES = 60;

/**
 * Creates a password-reset token and mails the link. Shared by
 * /api/auth/forgot-password and by the sign-up routes (known unverified
 * address). Quotas stay the caller's responsibility.
 */
export async function sendPasswordResetEmail(user: {
  id: string;
  name: string;
  email: string;
}): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token,
    expiresAt,
  });

  const baseUrl =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const template = passwordResetEmail({
    userName: user.name,
    resetUrl: `${baseUrl}/reset-password?token=${token}`,
    expiresInMinutes: RESET_TOKEN_EXPIRY_MINUTES,
  });

  await sendEmail({
    to: user.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}
