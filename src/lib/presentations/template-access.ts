import { NextResponse, type NextRequest } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getOrgMemberRole } from "@/lib/presentations/org-role";
import { guardPresentationsModule } from "@/lib/presentations/guards";
import type { SessionUser } from "@/types";

/**
 * Garde des modèles de présentation (lot 3bis).
 *
 * Un modèle est une ligne `presentations` rattachée à une organisation, sans
 * espace. Sa lecture est ouverte à tout membre de l'organisation ; son écriture
 * (création, modification, retrait, masquage, réinitialisation) est réservée à
 * l'administrateur de l'organisation. Aucune permission d'espace n'entre en
 * jeu : un modèle n'a pas d'espace.
 *
 * Chaque garde renvoie soit le contexte d'accès, soit une `NextResponse` à
 * retourner telle quelle, à la manière de `requireOrgScoped` et de
 * `guardPresentationsModule`. Un module coupé répond 404 avant toute décision
 * de rôle.
 */

export type TemplateRights = {
  /** Ligne d'appartenance réelle (ou super_admin). Sans elle : modèles LorIAx seuls. */
  isMember: boolean;
  /** Gère les modèles : super_admin, admin global membre, ou owner/admin d'appartenance. */
  canManage: boolean;
};

export type TemplateReaderContext = {
  user: SessionUser;
  orgId: string;
  orgSlug: string;
} & TemplateRights;

/**
 * Droits sur les modèles d'une organisation. Le rôle global `admin` ne vaut
 * que muni d'une ligne d'appartenance à CETTE organisation (sur le tenant
 * partagé `resolveRequestOrg` n'en exige pas) ; le propriétaire ou l'admin
 * d'appartenance gère les modèles quel que soit son rôle global.
 */
export async function resolveTemplateRights(
  user: Pick<SessionUser, "id" | "globalRole">,
  orgId: string
): Promise<TemplateRights> {
  if (hasGlobalRole(user.globalRole, "super_admin")) return { isMember: true, canManage: true };
  const role = await getOrgMemberRole(user.id, orgId);
  if (!role) return { isMember: false, canManage: false };
  return {
    isMember: true,
    canManage: role === "owner" || role === "admin" || hasGlobalRole(user.globalRole, "admin"),
  };
}

/**
 * Un non-membre ne voit que les modèles LorIAx (lignes semées) ; un modèle
 * masqué n'existe que pour qui gère les modèles.
 */
export function canSeeTemplateRow(
  rights: TemplateRights,
  row: { templateSeedKey: string | null; templateHiddenAt: Date | null }
): boolean {
  if (!rights.isMember && !row.templateSeedKey) return false;
  if (row.templateHiddenAt && !rights.canManage) return false;
  return true;
}

/** Un membre de l'organisation peut lire les modèles. */
export async function requireTemplateReader(
  req?: NextRequest
): Promise<TemplateReaderContext | NextResponse> {
  let ctx;
  try {
    ctx = await requireOrgScoped({}, req);
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const blocked = await guardPresentationsModule(ctx.user);
  if (blocked) return blocked;
  const rights = await resolveTemplateRights(ctx.user, ctx.orgId);
  return { ...ctx, ...rights };
}

/**
 * Refus d'écriture : 403 explicite pour un membre sans droit de gestion, 404
 * muet pour un non-membre (qui n'a rien à savoir des modèles de l'organisation).
 */
function denyUnlessManager(rights: TemplateRights): NextResponse | null {
  if (rights.canManage) return null;
  if (!rights.isMember) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(
    { error: "Réservé aux administrateurs de l'organisation" },
    { status: 403 }
  );
}

/** Seul un administrateur de l'organisation peut écrire un modèle. */
export async function requireTemplateAdmin(
  req?: NextRequest
): Promise<TemplateReaderContext | NextResponse> {
  const ctx = await requireTemplateReader(req);
  if (ctx instanceof NextResponse) return ctx;
  const denied = denyUnlessManager(ctx);
  if (denied) return denied;
  return ctx;
}

/**
 * Un modèle d'une autre organisation n'existe pas pour la requête : 404 muet,
 * sans indice sur son existence. `null` si la ligne appartient à `orgId`.
 */
export function assertTemplateInOrg(
  row: { organizationId: string | null },
  orgId: string
): NextResponse | null {
  if (row.organizationId !== orgId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  return null;
}

/**
 * Écriture d'un modèle déjà chargé : lecteur, puis 404 muet si le modèle est
 * d'une autre organisation, puis 403 si le rôle n'est pas admin. Cet ordre
 * évite qu'un non-admin d'une autre organisation distingue un modèle existant
 * (403) d'un identifiant inconnu (404).
 */
export async function requireTemplateAdminFor(
  row: { organizationId: string | null },
  req?: NextRequest
): Promise<TemplateReaderContext | NextResponse> {
  const ctx = await requireTemplateReader(req);
  if (ctx instanceof NextResponse) return ctx;
  const outside = assertTemplateInOrg(row, ctx.orgId);
  if (outside) return outside;
  const denied = denyUnlessManager(ctx);
  if (denied) return denied;
  return ctx;
}
