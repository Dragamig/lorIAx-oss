import { and, eq, isNull } from "drizzle-orm";
import { spaces, userDatabases } from "@/lib/db/schema";
import type { DbExecutor } from "../row-writes";
import { TemplateFailure, type TemplateContext } from "./types";

/**
 * Base de l'organisation, active, sur laquelle l'utilisateur est editor ou admin.
 * Organisation confrontée d'abord (not_found sans appeler permissionOf), puis permission (forbidden).
 */
export async function requireEditableDatabase(
  tx: DbExecutor,
  ctx: TemplateContext,
  databaseId: string,
): Promise<{ id: string; spaceId: string }> {
  const [target] = await tx
    .select({ id: userDatabases.id, spaceId: userDatabases.spaceId })
    .from(userDatabases)
    .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
    .where(
      and(
        eq(userDatabases.id, databaseId),
        eq(spaces.organizationId, ctx.orgId),
        isNull(userDatabases.archivedAt),
        isNull(userDatabases.deletedAt),
      ),
    )
    .limit(1);
  if (!target) throw new TemplateFailure({ code: "not_found" });
  const level = await ctx.permissionOf(ctx.userId, target.spaceId);
  if (level !== "editor" && level !== "admin") throw new TemplateFailure({ code: "forbidden" });
  return target;
}
