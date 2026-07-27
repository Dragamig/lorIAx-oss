import { NextResponse } from "next/server";
import { purgeAllData } from "@/lib/setup/purge";
import { guardSetupAccess } from "@/lib/setup/guards";
import { getSessionUser } from "@/lib/auth/get-user";
import { auditLog } from "@/lib/audit/log";
import { getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";

export async function POST(request: Request) {
  const access = await guardSetupAccess();
  if (!access.allowed) return access.response;

  const ip = getClientIp(request);
  // En mode installateur il n'y a pas de session : l'auteur reste inconnu, mais
  // l'opération et son adresse sont tracées.
  const user = await getSessionUser();
  // La purge supprime tous les comptes : l'identité de l'auteur est recopiée
  // dans les détails, la colonne user_id ne pourrait plus référencer la ligne.
  const details = {
    mode: access.mode,
    actorId: user?.id ?? null,
    actorEmail: user?.email ?? null,
  };

  try {
    await purgeAllData();

    // Opération la plus destructrice de l'application : elle vide une vingtaine
    // de tables et doit laisser une trace, comme les changements de réglages.
    auditLog("setup.purge", null, details, ip);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "[setup/purge] Erreur lors de la purge");
    auditLog("setup.purge.failed", user?.id ?? null, details, ip);
    return NextResponse.json(
      { error: "Erreur lors de la suppression des données" },
      { status: 500 }
    );
  }
}
