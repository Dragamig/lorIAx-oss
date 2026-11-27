import type { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabases } from "@/lib/db/schema";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import type { PermissionLevel, SessionUser } from "@/types";

/**
 * Contexte d'un outil du chat. Construit côté serveur depuis la session :
 * aucun outil ne reçoit d'identifiant utilisateur ou organisation du modèle.
 * L'identité (`user`, `orgId`) est résolue une fois dans la route et transmise à
 * requireOrgScoped : la garde ne relit ni cookies ni en-têtes, indisponibles
 * pendant le streaming. `req` reste optionnel.
 */
export type ChatToolContext = {
  user: SessionUser;
  orgId: string;
  spaceIds: string[];
  admin: boolean;
  req?: NextRequest;
};

const GENERIC_MESSAGE = "Base introuvable ou accès refusé";

export class ToolAccessError extends Error {
  constructor(public readonly code: "not_found" | "forbidden") {
    super(GENERIC_MESSAGE);
    this.name = "ToolAccessError";
  }
}

const RANK: Record<PermissionLevel, number> = { viewer: 1, editor: 2, admin: 3 };

/**
 * Garde d'accès à une base pour les outils du chat. 404 muet (message
 * identique) si la base est inexistante, archivée, supprimée, d'une autre
 * organisation (y compris pour admin et super_admin) ou sans accès en lecture.
 * `forbidden` seulement quand la lecture est acquise mais le seuil non atteint.
 */
export async function requireDatabaseAccess(
  ctx: ChatToolContext,
  databaseId: string,
  minPermission: "viewer" | "editor",
): Promise<{ databaseId: string; spaceId: string }> {
  let scoped;
  try {
    scoped = await requireOrgScoped(
      { resource: { type: "database", id: databaseId }, minPermission: "viewer" },
      ctx.req,
      { user: ctx.user, orgId: ctx.orgId },
    );
  } catch (e) {
    if (e instanceof OrgScopeError) throw new ToolAccessError("not_found");
    throw e;
  }

  if (scoped.orgId !== ctx.orgId || !scoped.spaceId || !scoped.permission) {
    throw new ToolAccessError("not_found");
  }

  const [active] = await db
    .select({ id: userDatabases.id })
    .from(userDatabases)
    .where(
      and(
        eq(userDatabases.id, databaseId),
        isNull(userDatabases.archivedAt),
        isNull(userDatabases.deletedAt),
      ),
    )
    .limit(1);
  if (!active) throw new ToolAccessError("not_found");

  if (RANK[scoped.permission] < RANK[minPermission]) {
    throw new ToolAccessError("forbidden");
  }
  return { databaseId, spaceId: scoped.spaceId };
}
