import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { SignJWT } from "jose";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import logger from "@/lib/logger";

/**
 * GET /api/auth/ws-token
 * Returns a short-lived JWT for WebSocket authentication.
 * The main session JWT is HTTP-only and cannot be read by client JS.
 *
 * Le jeton porte l'organisation courante (`orgId`), résolue **ici** depuis le
 * sous-domaine tant que le contexte HTTP existe : le canal WebSocket n'a pas
 * d'en-tête `x-org-slug` et ne peut pas la résoudre lui-même. Signée, la valeur
 * est digne de confiance à la validation (`verifyWsToken`) et sert au
 * cloisonnement multi-tenant de la collaboration temps réel. Elle n'est jamais
 * déclarée par le client.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Configuration manquante" }, { status: 500 });
  }

  // Fail-closed : sans organisation résolue, pas de jeton WebSocket
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    logger.warn({ userId: user.id }, "[ws-token] Organisation non résolue — jeton refusé");
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 403 });
  }

  try {
    const key = new TextEncoder().encode(secret);
    const token = await new SignJWT({
      id: user.id,
      email: user.email,
      name: user.name,
      globalRole: user.globalRole,
      avatarUrl: user.avatarUrl ?? null,
      orgId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(key);

    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "Token generation failed" }, { status: 500 });
  }
}
