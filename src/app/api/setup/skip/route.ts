// src/app/api/setup/skip/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemSettings, users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { guardSetupNotCompleted, guardSetupRoute } from "@/lib/setup/guards";
import { consumeBootstrapToken } from "@/lib/setup/bootstrap-token";

/**
 * « Plus tard » sur l'écran de configuration (parité 1.21.1).
 *
 * Deux publics : le porteur du jeton d'amorçage, et un super administrateur
 * connecté, qui n'a pas à retrouver le jeton pour écarter l'assistant vers
 * lequel la mise en page l'a lui-même redirigé. Dans les deux cas, quand
 * l'instance a déjà des comptes, l'assistant est clos pour de bon, sans quoi
 * une instance amorcée hors assistant resterait indéfiniment en attente. Sans
 * aucun compte, rien n'est clos : on condamnerait l'instance.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  const isSuperAdmin = user != null && hasGlobalRole(user.globalRole, "super_admin");

  const blocked = isSuperAdmin
    ? await guardSetupNotCompleted()
    : await guardSetupRoute(request);
  if (blocked) return blocked;

  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  if (anyUser) {
    const now = new Date();
    await db
      .insert(systemSettings)
      .values({ key: "setup_completed", value: true, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: true, updatedAt: now },
      });
    await consumeBootstrapToken();
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("setup_skipped", "1", {
    path: "/",
    maxAge: 86400, // 24h
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return response;
}
