import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  findUserIdByToken,
  sendVerificationEmail,
} from "@/lib/auth/email-verification";
import {
  authIdentityBucket,
  checkRateLimitAsync,
  getClientIpOrNull,
  ipKeyPart,
  isQuotaExceeded,
} from "@/lib/rate-limit";
import logger from "@/lib/logger";

const schema = z.union([
  z.object({
    email: z.string().trim().toLowerCase().email("Email invalide"),
  }),
  z.object({ token: z.string().min(1, "Token requis") }),
]);

const ADDRESS_TIERS = [
  { maxRequests: 1, windowMs: 60_000 },
  { maxRequests: 5, windowMs: 3_600_000 },
] as const;

const UNIFORM_MESSAGE =
  "Si un compte en attente existe, un nouveau lien vient d'être envoyé.";

const uniform = () => NextResponse.json({ message: UNIFORM_MESSAGE });

export async function POST(request: Request) {
  // Without a determinable address the IP tier is skipped; the per-address
  // tiers below still apply.
  const ip = getClientIpOrNull(request);
  if (ip) {
    const ipLimit = await checkRateLimitAsync(
      `resend-verification:${ipKeyPart(ip)}`,
      { maxRequests: 20, windowMs: 3_600_000 },
    );
    if (!ipLimit.success) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez plus tard." },
        { status: 429 },
      );
    }
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    let identity: string;
    let lookup: ReturnType<typeof eq>;
    if ("email" in parsed.data) {
      identity = parsed.data.email;
      lookup = eq(users.email, identity);
    } else {
      const userId = await findUserIdByToken(parsed.data.token);
      if (!userId) return uniform();
      identity = userId;
      lookup = eq(users.id, userId);
    }

    const exceeded = await isQuotaExceeded(
      `resend-verification:email:${authIdentityBucket(identity)}`,
      ADDRESS_TIERS,
    );
    if (exceeded) return uniform();

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(lookup)
      .limit(1);

    if (user && user.emailVerifiedAt === null) {
      await sendVerificationEmail({
        id: user.id,
        name: user.name,
        email: user.email,
      });
    }
    return uniform();
  } catch (error) {
    logger.error({ err: error }, "[resend-verification] Erreur renvoi du lien");
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
