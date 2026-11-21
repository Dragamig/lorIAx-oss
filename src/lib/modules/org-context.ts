import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";

/**
 * Organisation de la requête courante, pour borner les modules disponibles.
 *
 * Renvoie `null` dès que le contexte organisation n'est pas déterminable
 * (pas de session, pas de contexte de requête, organisation non résolue).
 * `null` signifie « aucun scope organisation » : les appelants retombent alors
 * sur le comportement historique piloté par la seule licence d'instance, ce qui
 * préserve le mono-tenant self-hosted et l'administration d'instance.
 *
 * Cette fonction ne doit jamais lever : un échec de résolution ne doit pas
 * casser un rendu de page ou une route.
 */
export async function getModuleScopeOrgId(): Promise<string | null> {
  try {
    const user = await getSessionUser();
    if (!user) return null;
    return await getRequestOrgId({
      id: user.id,
      globalRole: user.globalRole,
    });
  } catch {
    return null;
  }
}
