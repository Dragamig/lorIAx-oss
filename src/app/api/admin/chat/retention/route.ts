import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import {
  getChatRetentionDays,
  setChatRetentionDays,
} from "@/lib/chat/retention";
import logger from "@/lib/logger";

/**
 * GET /api/admin/chat/retention
 * Récupère le nombre de jours de rétention des messages chat
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const days = await getChatRetentionDays();
    return NextResponse.json({ days });
  } catch (err) {
    logger.error({ error: err }, "[api/admin/chat/retention] GET échoué");
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/chat/retention
 * Met à jour le nombre de jours de rétention
 * Body: { days: number } (1–3650)
 */
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const days = body?.days;

    // Validation
    if (typeof days !== "number" || !Number.isInteger(days)) {
      return NextResponse.json(
        { error: "Le paramètre 'days' doit être un entier" },
        { status: 400 }
      );
    }

    if (days < 1 || days > 3650) {
      return NextResponse.json(
        { error: "La valeur doit être entre 1 et 3650 jours" },
        { status: 400 }
      );
    }

    await setChatRetentionDays(days);
    logger.info({ days, userId: user.id }, "[api/admin/chat/retention] Configuration mise à jour");

    return NextResponse.json({ days });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Corps JSON invalide" },
        { status: 400 }
      );
    }
    logger.error({ error: err }, "[api/admin/chat/retention] PUT échoué");
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
