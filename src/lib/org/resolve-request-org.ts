import { db } from "@/lib/db";
import { organizations, organizationMembers } from "@/lib/db/schema-org";
import { eq, and } from "drizzle-orm";
import { getDefaultOrgId } from "./get-org-id";

export interface RequestOrg {
  orgId: string;
  orgSlug: string;
  /** true si l'org résolue est l'organisation partagée par défaut (tenant mutualisé `app`). */
  isDefaultOrg: boolean;
}

/**
 * Résout l'organisation d'une requête à partir du slug de sous-domaine
 * (header `x-org-slug` injecté par le middleware) et applique le contrôle
 * d'appartenance pour les organisations **isolées**.
 *
 * Modèle de siloing :
 * - slug `default`/absent → organisation partagée par défaut (apex, www). Pas
 *   de contrôle d'appartenance : c'est le tenant mutualisé historique.
 * - org isolée (id ≠ org par défaut) → `organization_members` requis
 *   (sauf `super_admin`). Sinon `null`.
 *
 * Retourne `null` si l'org est introuvable/inactive ou si l'utilisateur n'est
 * pas membre d'une org isolée. Le caller doit traduire `null` en 404
 * (ne jamais révéler l'existence d'une ressource d'une autre organisation).
 */
export async function resolveRequestOrg(
  slug: string | null | undefined,
  user: { id: string; canCrossOrg: boolean },
): Promise<RequestOrg | null> {
  const defaultOrgId = await getDefaultOrgId();

  // Org partagée par défaut (apex, www, ou pas de sous-domaine).
  if (!slug || slug === "default") {
    return { orgId: defaultOrgId, orgSlug: "default", isDefaultOrg: true };
  }

  let org;
  try {
    [org] = await db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        isActive: organizations.isActive,
      })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
  } catch (e) {
    return null;
  }

  if (!org || !org.isActive) return null;

  const isDefaultOrg = org.id === defaultOrgId;

  // Org isolée : appartenance obligatoire, y compris pour un `admin` global
  // (audit AZ-06). Seul `super_admin` franchit la frontière d'organisation.
  if (!isDefaultOrg && !user.canCrossOrg) {
    let member;
    try {
      [member] = await db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, org.id),
            eq(organizationMembers.userId, user.id),
          ),
        )
        .limit(1);
    } catch (e) {
      return null;
    }
    if (!member) return null;
  }

  return { orgId: org.id, orgSlug: org.slug, isDefaultOrg };
}

/**
 * Indique si un utilisateur ACCÈDE à une organisation donnée.
 *
 * Cloisonnement auto-suffisant (ne dépend pas du header de requête) : utilisé
 * par les contrôles d'accès qui n'ont pas accès au sous-domaine, notamment
 * CalDAV. L'org partagée par défaut est ouverte à tous les utilisateurs
 * authentifiés (tenant mutualisé historique) ; une org isolée exige une ligne
 * `organization_members`. `orgId` NULL/absent (ressource org-neutre) → false.
 *
 * Ne connaît pas le rôle global : c'est l'accès seul. Un appelant qui doit
 * laisser passer `super_admin` le fait explicitement, jamais par défaut.
 *
 * ATTENTION, deux questions distinctes que le code confondait avant le
 * 2026-08-20 (revue adversariale du lot 6) :
 *
 * - « cet utilisateur a-t-il accès à cette organisation ? » → `isOrgMember`,
 *   qui rend toujours vrai sur l'organisation partagée par défaut. C'est la
 *   règle historique du produit, elle n'est pas remise en cause ;
 * - « son rôle global lui donne-t-il l'ADMINISTRATION de cette
 *   organisation ? » → {@link hasOrgMembershipRow}, qui exige une vraie ligne
 *   `organization_members`, y compris sur l'organisation par défaut.
 *
 * Borner une dispense de rôle avec `isOrgMember` ne borne rien sur le tenant
 * mutualisé : un `admin` d'un tenant isolé y récupérerait l'administration de
 * tous les espaces, classification `secret` comprise. Une dispense de rôle
 * passe donc TOUJOURS par `hasOrgMembershipRow`.
 */
export async function isOrgMember(
  userId: string,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!orgId) return false;

  const defaultOrgId = await getDefaultOrgId();
  if (orgId === defaultOrgId) return true;

  return hasOrgMembershipRow(userId, orgId);
}

/**
 * Appartenance RÉELLE : existe-t-il une ligne `organization_members` liant cet
 * utilisateur à cette organisation ?
 *
 * Contrairement à {@link isOrgMember}, aucun raccourci pour l'organisation
 * partagée par défaut : l'ouverture de ce tenant est une règle d'ACCÈS, pas une
 * preuve d'appartenance. C'est la fonction à utiliser pour borner une dispense
 * accordée au rôle global (`getSpacePermission`), jamais pour décider d'un
 * accès ordinaire.
 */
export async function hasOrgMembershipRow(
  userId: string,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!orgId) return false;

  const [member] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);

  return !!member;
}
