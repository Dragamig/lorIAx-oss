// src/app/api/setup/access/route.ts
import { NextResponse } from "next/server";
import {
  ensureInstallToken,
  hasValidInstallToken,
  isSetupCompleted,
  setInstallTokenCookie,
  verifyInstallToken,
} from "@/lib/setup/guards";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { checkRateLimit, RATE_LIMITS, getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";

/**
 * État d'accès à l'assistant de configuration, consommé par l'écran /setup.
 * - "completed"      : l'instance est déjà configurée.
 * - "granted"        : le client peut dérouler l'assistant.
 * - "forbidden"      : connecté, mais sans le rôle super_admin.
 * - "token_required" : il faut présenter le jeton d'installation.
 * Aucun secret n'est renvoyé : le jeton ne sort que par les journaux serveur.
 */
export async function GET() {
  if (await isSetupCompleted()) {
    return NextResponse.json({ status: "completed" });
  }

  if (await hasValidInstallToken()) {
    return NextResponse.json({ status: "granted" });
  }

  const user = await getSessionUser();
  if (user) {
    return NextResponse.json({
      status: hasGlobalRole(user.globalRole, "super_admin") ? "granted" : "forbidden",
    });
  }

  // Crée le jeton au besoin et le (re)journalise pour l'exploitant.
  await ensureInstallToken();
  return NextResponse.json({ status: "token_required" });
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`setup-access:${ip}`, RATE_LIMITS.auth);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez plus tard." },
      { status: 429 }
    );
  }

  if (await isSetupCompleted()) {
    return NextResponse.json(
      { error: "L'instance est déjà configurée" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const token =
    body && typeof body === "object" && typeof (body as { token?: unknown }).token === "string"
      ? (body as { token: string }).token.trim()
      : "";

  if (!token) {
    return NextResponse.json(
      { error: "Le jeton d'installation est obligatoire" },
      { status: 400 }
    );
  }

  if (!(await verifyInstallToken(token))) {
    logger.warn({ ip }, "[setup/access] Jeton d'installation invalide");
    return NextResponse.json(
      { error: "Jeton d'installation invalide" },
      { status: 401 }
    );
  }

  return setInstallTokenCookie(NextResponse.json({ status: "granted" }), token);
}
