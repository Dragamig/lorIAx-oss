import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireBootstrapToken } from "@/lib/setup/bootstrap-token";

/**
 * Vérifie que l'instance n'a pas encore terminé la configuration initiale.
 * Retourne une NextResponse 403 si setup_completed === true, sinon null.
 *
 * Ligne absente : `row?.value` ne déréférence rien et la garde laisse passer,
 * ce qui est le comportement voulu sur une instance neuve (note annexe du
 * constat AZ-28).
 */
export async function guardSetupNotCompleted(): Promise<NextResponse | null> {
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "setup_completed"))
    .limit(1);

  if (row?.value === true) {
    return NextResponse.json(
      { error: "L'instance est déjà configurée" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Garde complète des routes de l'assistant d'installation (constat AZ-28) :
 * jeton d'amorçage exigé, PUIS vérification que l'assistant n'est pas déjà
 * terminé. L'ordre importe : un appelant sans jeton n'apprend rien de l'état
 * de l'instance, et un appelant muni du bon jeton reste refusé une fois
 * l'installation achevée, la garde historique n'étant pas affaiblie.
 */
export async function guardSetupRoute(request: Request): Promise<NextResponse | null> {
  const unauthorized = await requireBootstrapToken(request);
  if (unauthorized) return unauthorized;
  return guardSetupNotCompleted();
}
