import { db } from "@/lib/db";
import { systemSettings, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export interface RegistrationRefusal {
  status: number;
  error: string;
}

/**
 * Politique de l'inscription libre (`/api/auth/register`), appliquee cote serveur.
 *
 * - Instance non amorcee (assistant non termine ET aucun super administrateur) :
 *   refus. Sans cela, un tiers s'inscrit avant la creation du premier
 *   administrateur. Une instance deja pourvue d'un super administrateur (amorcee
 *   hors assistant, ou provisionnee par l'edition commerciale) n'est pas
 *   concernee par ce premier refus.
 * - Reglage « Inscription ouverte » (`system_settings.auth.allowRegistration`) :
 *   seul un `true` explicite ouvre la route. Absent, il vaut `false` (decision
 *   2.0.0 : fermee par defaut, installations neuves comme instances venues de
 *   1.21.x). L'administrateur l'ouvre dans les reglages.
 */
export async function getRegistrationRefusal(): Promise<RegistrationRefusal | null> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(inArray(systemSettings.key, ["auth", "setup_completed"]));

  const completed = rows.find((r) => r.key === "setup_completed")?.value === true;

  if (!completed) {
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
  }

  const auth = rows.find((r) => r.key === "auth")?.value as
    | { allowRegistration?: unknown }
    | null
    | undefined;
  if (auth?.allowRegistration !== true) {
    return { status: 403, error: "L'inscription est fermée sur cette instance." };
  }
  return null;
}
