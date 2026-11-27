import { db } from "@/lib/db";
import { systemSettings, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { INCLUDED_MODULE_IDS } from "@/lib/modules/registry.generated";
import type { ModuleId } from "@/lib/modules/types";
import { resolveAllowRegistration } from "./registration-default";

export interface RegistrationRefusal {
  status: number;
  error: string;
}

/**
 * Politique de l'inscription libre (`/api/auth/register`), appliquee cote serveur.
 * Elle depend de l'edition (meme detection que `ensureDefaultOrganizationForEdition` :
 * presence du module `commercial`).
 *
 * Edition oss :
 * - aucun super administrateur : refus, quoi que dise `setup_completed`
 *   (sans cela, un tiers s'inscrit avant la creation du premier administrateur) ;
 * - reglage `system_settings.auth.allowRegistration` : seul un `true` explicite
 *   ouvre la route. Absent, il vaut `false` (decision 2.0.0 : fermee par defaut).
 *
 * Edition commerciale : comme main (AZ-27), fermee par defaut. Seul un `true`
 * explicite de l'administrateur ouvre la route (lien « Creer un compte »,
 * /register, 409 needsOrg vers la creation d'organisation).
 */
export async function getRegistrationRefusal(
  includedModuleIds: readonly ModuleId[] = INCLUDED_MODULE_IDS,
): Promise<RegistrationRefusal | null> {
  const commercial = includedModuleIds.includes("commercial");

  const rows = await db
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, ["auth", "setup_completed"]));

  const auth = rows.find((r) => r.key === "auth")?.value as
    | { allowRegistration?: unknown }
    | null
    | undefined;

  if (commercial) {
    if (!resolveAllowRegistration(auth?.allowRegistration)) {
      return { status: 403, error: "L'inscription est fermée sur cette instance." };
    }
    return null;
  }

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.globalRole, "super_admin"))
    .limit(1);
  if (!admin) {
    return {
      status: 403,
      error: "L'instance n'est pas encore configurée. L'inscription est fermée.",
    };
  }
  if (!resolveAllowRegistration(auth?.allowRegistration)) {
    return { status: 403, error: "L'inscription est fermée sur cette instance." };
  }
  return null;
}
