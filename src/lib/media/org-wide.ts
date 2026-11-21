import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";

/**
 * Un média est « lisible par toute l'organisation » quand il vit dans un espace
 * de type `organization` non classé `secret` de cette organisation : c'est le
 * seul cas où `getSpacePermission` accorde la lecture à chaque membre sans
 * ligne explicite. Un média sans espace n'est lisible que de son auteur et des
 * admin/owner (règle 4 de `access.ts`), il ne convient donc pas.
 */
export async function isOrgWideSpace(spaceId: string | null, orgId: string): Promise<boolean> {
  if (!spaceId) return false;
  const [space] = await db
    .select({ type: spaces.type, classification: spaces.classification })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.organizationId, orgId)))
    .limit(1);
  return !!space && space.type === "organization" && space.classification !== "secret";
}
