import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeVerificationToken } from "@/lib/auth/email-verification";
import {
  checkRateLimitAsync,
  getClientIpOrNull,
  ipKeyPart,
} from "@/lib/rate-limit";
import logger from "@/lib/logger";

const schema = z.object({
  token: z.string().min(1, "Token requis"),
});

export async function POST(request: Request) {
  const ip = getClientIpOrNull(request);
  // Without a determinable address the IP tier is skipped rather than shared
  // by every anonymous client (AZ-25).
  if (ip) {
    const limit = await checkRateLimitAsync(`verify-email:${ipKeyPart(ip)}`, {
      maxRequests: 30,
      windowMs: 3_600_000,
    });
    if (!limit.success) {
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

    const result = await consumeVerificationToken(parsed.data.token);
    if (result.status === "verified") {
      return NextResponse.json({ status: "verified" });
    }
    return NextResponse.json({ status: result.status }, { status: 400 });
  } catch (error) {
    logger.error({ err: error }, "[verify-email] Erreur vérification");
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
