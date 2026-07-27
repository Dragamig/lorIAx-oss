// src/app/api/setup/skip/route.ts
import { NextResponse } from "next/server";
import {
  clearInstallTokenCookie,
  hasAnyUser,
  hasValidInstallToken,
  isSetupCompleted,
  markSetupCompleted,
} from "@/lib/setup/guards";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";

/**
 * « Plus tard » sur l'écran de configuration.
 *
 * Deux publics distincts, d'où une garde plus souple que guardSetupAccess() :
 * tout utilisateur authentifié doit pouvoir écarter l'assistant et rejoindre
 * l'application, alors que la fermeture définitive du wizard reste un acte
 * d'administration.
 */
export async function POST() {
  if (await isSetupCompleted()) {
    return NextResponse.json(
      { error: "L'instance est déjà configurée" },
      { status: 403 }
    );
  }

  const installer = await hasValidInstallToken();
  const user = await getSessionUser();

  if (!installer && !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // Le drapeau ferme l'assistant pour de bon : sans cela, une instance seedée
  // ou restaurée resterait indéfiniment en attente de configuration, le drapeau
  // n'étant écrit que par /api/setup/complete.
  // Deux réserves :
  // - le poser est réservé à l'exploitant (jeton d'installation ou super_admin),
  //   un simple lecteur ne fait que masquer l'écran pour lui-même ;
  // - sur une instance sans aucun compte, le poser condamnerait l'instance,
  //   plus d'assistant et personne pour se connecter.
  const mayClose =
    installer || (user != null && hasGlobalRole(user.globalRole, "super_admin"));
  const closed = mayClose && (await hasAnyUser());

  if (closed) {
    await markSetupCompleted();
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("setup_skipped", "1", {
    path: "/",
    maxAge: 86400, // 24h
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  // Le cookie de jeton n'est effacé que si l'assistant est réellement clos,
  // pour ne pas obliger l'exploitant à ressaisir son jeton s'il revient.
  return closed ? clearInstallTokenCookie(response) : response;
}
