import { z } from "zod";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";

/**
 * Une base cible de relation doit exister, appartenir à l'organisation courante
 * et être modifiable (`editor`) par l'utilisateur. Tout échec est indiscernable
 * (pas d'oracle d'existence) : l'appelant répond 404.
 */
export async function canTargetRelationDatabase(targetDatabaseId: unknown): Promise<boolean> {
  if (!z.string().uuid().safeParse(targetDatabaseId).success) return false;
  try {
    await requireOrgScoped({
      resource: { type: "database", id: targetDatabaseId as string },
      minPermission: "editor",
    });
    return true;
  } catch (e) {
    if (e instanceof OrgScopeError) return false;
    throw e;
  }
}
