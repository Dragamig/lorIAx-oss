/**
 * Helper de siloing strict — point d'entrée unique pour autoriser une route
 * d'API à toucher une ressource appartenant à une organisation.
 *
 * Voir docs/superpowers/specs/2026-05-26-espace-bases-design.md §4 R1.
 *
 * Règle d'or : aucune nouvelle route ne doit interroger une ressource sans
 * passer par ce helper d'abord, et toute ressource vient avec son seuil de
 * permission (`minPermission`), rendu obligatoire par le type.
 *
 * En cas de mismatch org ↔ ressource, on renvoie 404 (jamais 403) pour ne pas
 * révéler l'existence d'une ressource d'une autre organisation.
 */

import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { spaces, userDatabases } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getSpacePermission } from "@/lib/auth/check-access";
import { canCrossOrgBoundary } from "@/lib/auth/rbac";
import { resolveRequestOrg } from "@/lib/org/resolve-request-org";
import type { SessionUser, PermissionLevel } from "@/types";

/** Erreur typée renvoyée quand l'autorisation échoue ; le caller doit la retourner telle quelle. */
export class OrgScopeError extends Error {
  constructor(
    public readonly response: NextResponse,
    public readonly reason:
      | "unauthenticated"
      | "no-org"
      | "org-not-found"
      | "not-member"
      | "resource-not-found"
      | "permission-denied"
  ) {
    super(reason);
  }
}

export interface OrgScopedContext {
  user: SessionUser;
  orgId: string;
  orgSlug: string;
  /** spaceId résolu si une ressource a été vérifiée */
  spaceId?: string;
  /** Permission sur le space si un space a été résolu */
  permission?: PermissionLevel | null;
}

/** Ressource dont l'appartenance à l'organisation courante doit être vérifiée. */
export type OrgScopeResource =
  | { type: "space"; id: string }
  | { type: "database"; id: string };

/**
 * Options du helper. Le type est volontairement une union discriminée :
 * dès qu'une `resource` est passée, `minPermission` devient **obligatoire**.
 *
 * Motivation (audit du 2026-08-19, constat P0-4 / AZ-01) : `minPermission`
 * était optionnel, et 17 routes vérifiaient l'organisation sans jamais
 * vérifier le droit d'accès à l'espace. Le contrôle d'organisation et le
 * contrôle de permission d'espace sont deux gestes distincts, et le type
 * force désormais à poser les deux. Un appelant qui oublie le seuil ne
 * compile plus.
 */
export type OrgScopeOptions =
  | {
      /** Résolution de l'organisation courante seule, sans ressource. */
      resource?: undefined;
      minPermission?: never;
    }
  | {
      /** Vérifier qu'une ressource appartient bien à l'org de l'utilisateur */
      resource: OrgScopeResource;
      /** Permission minimale requise sur le space. Obligatoire, `viewer` au minimum. */
      minPermission: PermissionLevel;
    };

/** Réponse 404 standard. Volontairement vague pour ne pas leak l'existence. */
function notFound(): NextResponse {
  return NextResponse.json({ error: "Introuvable" }, { status: 404 });
}

function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
}

function permissionDenied(): NextResponse {
  return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
}

/** Ordre hiérarchique des permissions (du moins au plus puissant). */
const PERMISSION_RANK: Record<PermissionLevel, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

function hasMinPermission(actual: PermissionLevel | null, required: PermissionLevel): boolean {
  if (!actual) return false;
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[required];
}

/**
 * Résout l'organisation courante depuis le header `x-org-slug` injecté par le
 * proxy (`src/proxy.ts`), en DÉLÉGUANT la règle à `resolveRequestOrg`.
 *
 * Cette fonction recopiait la règle au lieu de l'appeler, avec la consigne de
 * garder les deux copies alignées. La revue adversariale du lot 6 a trouvé
 * l'écart déjà installé, et double :
 *
 * - la copie sélectionnait l'organisation par slug SANS lire `is_active` : une
 *   organisation désactivée, geste de suspension d'un tenant, restait
 *   pleinement servie par la trentaine de routes branchées sur
 *   `requireOrgScoped`, alors que toutes les routes passées par
 *   `getRequestOrgId` la refusaient ;
 * - sur le domaine racine, la copie rendait la PREMIÈRE organisation dont
 *   l'utilisateur est membre là où `resolveRequestOrg` rend l'organisation
 *   partagée par défaut. Deux routes servies dans la même requête pouvaient
 *   donc travailler sur deux organisations différentes.
 *
 * Le repli sur la première appartenance est retiré avec la copie : le proxy
 * pose toujours l'en-tête (`default` sur l'apex et hors mode sous-domaine), et
 * ce cas est précisément celui du tenant mutualisé, ouvert à tout compte
 * authentifié. Aucun utilisateur ne perd d'accès, et les deux chemins de
 * résolution rendent désormais la même organisation pour la même requête.
 *
 * `null` = aucun accès (fail-closed), à traduire en 404 par l'appelant.
 */
async function resolveCurrentOrg(
  user: SessionUser,
  req?: NextRequest
): Promise<{ orgId: string; orgSlug: string } | null> {
  let slug: string | null = null;

  if (req) {
    slug = req.headers.get("x-org-slug");
  } else {
    try {
      const h = await headers();
      slug = h.get("x-org-slug");
    } catch {
      slug = null;
    }
  }

  // Appartenance obligatoire sur une organisation isolée, y compris pour un
  // `admin` global (audit AZ-06). Seul `super_admin` franchit la frontière.
  const org = await resolveRequestOrg(slug, {
    id: user.id,
    canCrossOrg: canCrossOrgBoundary(user.globalRole),
  });

  return org ? { orgId: org.orgId, orgSlug: org.orgSlug } : null;
}

/**
 * Point d'entrée unique pour autoriser une route API à toucher une ressource.
 *
 * @throws OrgScopeError — la response à renvoyer telle quelle est dans .response
 *
 * Usage :
 * ```ts
 * try {
 *   const ctx = await requireOrgScoped({ resource: { type: "database", id }, minPermission: "editor" });
 *   // ... ctx.spaceId est garanti dans l'org courante
 * } catch (e) {
 *   if (e instanceof OrgScopeError) return e.response;
 *   throw e;
 * }
 * ```
 */
export async function requireOrgScoped(
  options: OrgScopeOptions = {},
  req?: NextRequest
): Promise<OrgScopedContext> {
  const user = await getSessionUser();
  if (!user) throw new OrgScopeError(unauthenticated(), "unauthenticated");

  const org = await resolveCurrentOrg(user, req);
  if (!org) throw new OrgScopeError(notFound(), "no-org");

  if (!options.resource) {
    return { user, orgId: org.orgId, orgSlug: org.orgSlug };
  }

  // Résoudre la ressource jusqu'à son spaceId et vérifier qu'elle appartient à org.
  let spaceId: string | undefined;

  if (options.resource.type === "space") {
    const [s] = await db
      .select({ id: spaces.id, organizationId: spaces.organizationId })
      .from(spaces)
      .where(eq(spaces.id, options.resource.id))
      .limit(1);
    if (!s || s.organizationId !== org.orgId) {
      throw new OrgScopeError(notFound(), "resource-not-found");
    }
    spaceId = s.id;
  } else if (options.resource.type === "database") {
    // Jointure database → space → org en une requête
    const [row] = await db
      .select({ spaceId: spaces.id, organizationId: spaces.organizationId })
      .from(userDatabases)
      .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
      .where(eq(userDatabases.id, options.resource.id))
      .limit(1);
    if (!row || row.organizationId !== org.orgId) {
      throw new OrgScopeError(notFound(), "resource-not-found");
    }
    spaceId = row.spaceId;
  }

  if (!spaceId) throw new OrgScopeError(notFound(), "resource-not-found");

  // Vérifier la permission sur le space
  const permission = await getSpacePermission(user.id, spaceId);

  // Fail-closed : si le seuil manque (appelant non typé, JS, test), on exige
  // `viewer`. Le type interdit déjà l'oubli, ce garde-fou couvre le reste.
  const required: PermissionLevel = options.minPermission ?? "viewer";
  if (!hasMinPermission(permission, required)) {
    // Permission mismatch dans une org dont on est membre = vrai 403
    throw new OrgScopeError(permissionDenied(), "permission-denied");
  }

  return {
    user,
    orgId: org.orgId,
    orgSlug: org.orgSlug,
    spaceId,
    permission,
  };
}
