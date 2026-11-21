import { NextResponse, type NextRequest } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { isUuid } from "@/lib/databases/row-history-read";
import type { PermissionLevel } from "@/types";

export type RowScope = {
  userId: string;
  userName: string;
  orgId: string;
  /** Issu de la base de donnees (jamais du client) : makeCanView(spaceId) s'y fie. */
  spaceId: string;
  permission: PermissionLevel;
};

const RANK: Record<PermissionLevel, number> = { viewer: 1, editor: 2, admin: 3 };

function notFound(): NextResponse {
  return NextResponse.json({ error: "Introuvable" }, { status: 404 });
}

/**
 * Garde commune aux routes de ligne. Verifie d'abord l'acces en lecture
 * (404 muet si autre organisation, base inexistante ou sans acces), puis le
 * seuil demande (403), pour ne jamais reveler l'existence d'une base.
 */
export async function requireRowScope(
  request: NextRequest,
  args: { databaseId: string; rowId?: string; min: "viewer" | "editor" | "admin" }
): Promise<RowScope | NextResponse> {
  if (!isUuid(args.databaseId)) return notFound();
  if (args.rowId !== undefined && !isUuid(args.rowId)) return notFound();

  let ctx;
  try {
    ctx = await requireOrgScoped(
      { resource: { type: "database", id: args.databaseId }, minPermission: "viewer" },
      request
    );
  } catch (e) {
    if (e instanceof OrgScopeError) {
      return e.response.status === 403 ? notFound() : e.response;
    }
    throw e;
  }

  const permission = ctx.permission;
  if (!ctx.spaceId || !permission) return notFound();
  if (RANK[permission] < RANK[args.min]) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  return {
    userId: ctx.user.id,
    userName: ctx.user.name,
    orgId: ctx.orgId,
    spaceId: ctx.spaceId,
    permission,
  };
}
