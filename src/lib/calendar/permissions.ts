import { db } from "@/lib/db";
import {
  calendars,
  calendarSubscriptions,
  teamMembers,
} from "@/lib/db/schema";
import { eq, and, inArray, or, isNull } from "drizzle-orm";
import { hasGlobalRole, canCrossOrgBoundary } from "@/lib/auth/rbac";
import { getSpacePermission } from "@/lib/auth/check-access";
import { isOrgMember, hasOrgMembershipRow } from "@/lib/org/resolve-request-org";
import type { SessionUser, CalendarPermission } from "@/types";

/**
 * Autorise (ou non) une action sur un calendrier, dans une organisation donnée.
 *
 * `orgId` est l'organisation de la requête, résolue par l'appelant
 * (`getRequestOrgId` en session, `user.orgId` pour une clé d'API v1). Elle est
 * un paramètre EXPLICITE et OBLIGATOIRE, jamais devinée ici, exactement comme
 * `getMeetingInOrg` / `listMeetings` du module visio (ADR-079).
 *
 * Elle était auparavant optionnelle, et le filtre n'était appliqué que si elle
 * était fournie ET que le calendrier portait une organisation : sur 23 points
 * d'appel, un seul la passait, les 22 autres sautaient donc intégralement le
 * cloisonnement. Deux conséquences, corrigées ici :
 * - le type interdit désormais l'oubli ;
 * - `null` vaut REFUS (fail-closed), jamais « pas de filtre ». `null` est ce
 *   que rend `getRequestOrgId` quand l'organisation est introuvable, inactive
 *   ou que l'utilisateur n'en est pas membre : le traiter comme « accès
 *   global » rouvrirait précisément la faille.
 *
 * Deux natures de calendriers, traitées différemment :
 * - calendrier rattaché à une organisation (équipe, espace, organisation) :
 *   il doit être celui de l'organisation de la requête, sinon refus sec ;
 * - calendrier org-neutre (`organization_id` NULL, c'est-à-dire personnel par
 *   construction, cf. migration 0037) : il n'appartient à aucun tenant, il
 *   reste donc joignable, mais par les seuls liens EXPLICITES user→calendrier
 *   (propriété, abonnement). Les replis partagés (équipe, organisation,
 *   espace) supposent tous une organisation : sur un calendrier qui n'en a
 *   pas, ils ne s'appliquent pas. Personne ne perd son calendrier personnel,
 *   et aucun repli ne s'ouvre sur un objet sans tenant.
 */
export async function checkCalendarAccess(
  userId: string,
  calendarId: string,
  action: "read" | "write" | "admin",
  orgId: string | null
): Promise<boolean> {
  // Fail-closed : pas d'organisation résolue, pas d'accès.
  if (!orgId) return false;

  const calendar = await db
    .select()
    .from(calendars)
    .where(eq(calendars.id, calendarId))
    .limit(1);

  if (calendar.length === 0) return false;
  const cal = calendar[0];

  // Cloisonnement multi-tenant : un calendrier rattaché à une organisation
  // n'est accessible que depuis cette organisation (sous-domaine / clé d'API).
  if (cal.organizationId && cal.organizationId !== orgId) {
    return false;
  }

  // Owner always has full access
  if (cal.ownerUserId === userId) return true;

  // Check subscription-based permission
  const sub = await db
    .select()
    .from(calendarSubscriptions)
    .where(
      and(
        eq(calendarSubscriptions.calendarId, calendarId),
        eq(calendarSubscriptions.userId, userId)
      )
    )
    .limit(1);

  if (sub.length > 0) {
    const perm = sub[0].permission;
    if (action === "read") return true;
    if (action === "write") return perm === "write" || perm === "admin";
    if (action === "admin") return perm === "admin";
  }

  // Calendrier org-neutre : aucun repli partagé. Les trois chemins qui suivent
  // (équipe, organisation, espace) qualifient une appartenance à un tenant ;
  // un calendrier sans organisation n'en a aucune à opposer.
  if (!cal.organizationId) return false;

  // Team calendar: check team membership
  if (cal.type === "team" && cal.ownerTeamId) {
    const membership = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, cal.ownerTeamId),
          eq(teamMembers.userId, userId)
        )
      )
      .limit(1);

    if (membership.length > 0) {
      if (action === "read") return true;
      if (action === "write") return true;
      if (action === "admin") return membership[0].role === "admin";
    }
  }

  // Organization calendar: lecture réservée aux membres de l'org du calendrier
  // (cloisonnement multi-tenant ; ne fuit plus vers les autres organisations).
  if (cal.type === "organization") {
    if (action === "read" && (await isOrgMember(userId, cal.organizationId))) {
      return true;
    }
  }

  // Check via associated space permissions
  if (cal.spaceId) {
    return await checkSpaceBasedAccess(userId, cal.spaceId, action);
  }

  return false;
}

/**
 * Accès à un calendrier via l'espace auquel il est rattaché.
 *
 * Le calcul de permission d'espace était dupliqué ici (ligne nominative, puis
 * lignes d'équipe avec sélection du meilleur niveau). Il est désormais délégué
 * à `getSpacePermission`, le calcul unique du produit. La signature et la
 * traduction niveau vers action sont conservées, pour ne toucher qu'un seul
 * point d'appel.
 *
 * Deux chemins d'accès s'ouvrent au passage, volontairement : les replis
 * d'appartenance (équipe propriétaire de l'espace, espace de type
 * `organization`) et la dispense de rôle global. Un admin global membre de
 * l'organisation obtient donc `admin` sur les calendriers liés à un espace,
 * comme partout ailleurs dans le produit. Depuis le correctif AZ-06, cette
 * dispense est bornée par `hasOrgMembershipRow` à l'organisation dont il porte
 * une vraie ligne d'appartenance, tenant mutualisé compris.
 *
 * Élargissement assumé, et mesuré. Le repli « espace de type organisation »
 * rend `editor`, donc l'action d'écriture passe : un calendrier rattaché à un
 * tel espace, jusque-là réservé aux porteurs d'une ligne nominative de
 * `space_permissions`, devient inscriptible par tout membre de l'organisation
 * de l'espace. Le seuil n'est délibérément PAS relevé, pour trois raisons :
 * 1. `GET /api/spaces`, la référence d'affichage du produit, liste déjà les
 *    espaces de type `organization` à tout membre de l'organisation, et le
 *    produit y autorise la création de documents et de bases. Un calendrier
 *    d'espace est une ressource d'espace comme une autre : le réserver à une
 *    ligne nominative était l'incohérence, pas l'inverse.
 * 2. Le repli exige une vraie ligne `organization_members` sur l'organisation
 *    DE L'ESPACE (il n'ouvre rien au tenant mutualisé par défaut), et les
 *    espaces classés `secret` en sont exclus.
 * 3. Le cloisonnement rétabli en amont borne cet élargissement à
 *    l'organisation de la requête : il ne franchit aucune frontière de tenant.
 * L'action `admin` (renommer ou supprimer le calendrier) reste, elle, réservée
 * au niveau `admin`, donc aux `owner`/`admin` de l'organisation.
 */
async function checkSpaceBasedAccess(
  userId: string,
  spaceId: string,
  action: "read" | "write" | "admin"
): Promise<boolean> {
  const level = await getSpacePermission(userId, spaceId);
  if (!level) return false;

  if (action === "read") return true;
  if (action === "write") return level === "editor" || level === "admin";
  return level === "admin";
}

/**
 * Identifiants des calendriers visibles par un utilisateur, confinés à une
 * organisation.
 *
 * `orgId` est l'organisation de la requête (sous-domaine ou clé d'API), et
 * elle est appliquée à TOUTES les branches. Deux d'entre elles ne la
 * filtraient pas, alors que l'en-tête de cette fonction affirmait le
 * contraire : les abonnements et les calendriers d'équipe. Un utilisateur
 * membre de deux organisations voyait donc, sur le sous-domaine de la
 * première, les calendriers d'équipe et les calendriers abonnés de la seconde
 * (même fuite de métadonnées que la liste des réunions, corrigée en 1.99.9 par
 * `listMeetings` ; on en reprend la forme, pas une seconde règle).
 *
 * Traversent le filtre, et eux seuls :
 * - les calendriers de `orgId` ;
 * - les calendriers org-neutres (`organization_id` NULL, personnels par
 *   construction), qui n'appartiennent à aucun tenant.
 * C'est exactement le couple que `checkCalendarAccess` accepte : la liste ne
 * peut donc plus afficher un calendrier que la route suivante refuserait.
 */
export async function getAccessibleCalendarIds(
  user: SessionUser,
  orgId: string
): Promise<string[]> {
  /** Calendrier de l'organisation courante, ou calendrier org-neutre. */
  const dansOrgOuNeutre = or(
    eq(calendars.organizationId, orgId),
    isNull(calendars.organizationId)
  );

  // Own calendars : les siens dans l'org courante + ses personnels org-neutres.
  // Sans ce filtre, un calendrier créé par l'utilisateur dans une AUTRE
  // organisation (dont il est aussi membre) s'affichait ici, puis répondait
  // 403 à la route suivante depuis le correctif de cloisonnement.
  const ownCalendars = await db
    .select({ id: calendars.id })
    .from(calendars)
    .where(and(eq(calendars.ownerUserId, user.id), dansOrgOuNeutre));

  // Dispense de rôle : tous les calendriers de l'org courante, en plus des
  // siens. Elle suit la doctrine du complément d'ADR-079 (2026-08-20), et non
  // une seconde règle : `super_admin` administre l'instance et franchit donc la
  // frontière sans condition ; `admin` est un rôle d'INSTANCE, il n'administre
  // une organisation que s'il en est réellement membre.
  //
  // `hasOrgMembershipRow`, jamais `isOrgMember` : ce dernier répond toujours
  // vrai sur le tenant mutualisé, qui porte les vraies données. Borner la
  // dispense avec lui ne bornerait rien sur le domaine racine, où l'admin d'un
  // tenant isolé listait jusqu'ici tous les calendriers du tenant partagé.
  // L'accès ORDINAIRE au tenant mutualisé, lui, reste inchangé : les branches
  // qui suivent (propriété, abonnement, calendrier d'organisation, équipe)
  // continuent d'y répondre.
  const dispenseDeRole =
    canCrossOrgBoundary(user.globalRole) ||
    (hasGlobalRole(user.globalRole, "admin") &&
      (await hasOrgMembershipRow(user.id, orgId)));

  if (dispenseDeRole) {
    const orgScoped = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.organizationId, orgId));
    return [...new Set([...ownCalendars.map((c) => c.id), ...orgScoped.map((c) => c.id)])];
  }

  // Subscribed calendars (lien explicite user→calendrier), confinés eux aussi :
  // un abonnement est un lien, pas une dispense de cloisonnement.
  const subs = await db
    .select({ calendarId: calendarSubscriptions.calendarId })
    .from(calendarSubscriptions)
    .innerJoin(calendars, eq(calendars.id, calendarSubscriptions.calendarId))
    .where(and(eq(calendarSubscriptions.userId, user.id), dansOrgOuNeutre));

  // Organization calendars de l'org courante uniquement
  const orgCalendars = await db
    .select({ id: calendars.id })
    .from(calendars)
    .where(
      and(
        eq(calendars.type, "organization"),
        eq(calendars.organizationId, orgId)
      )
    );

  // Team calendars where user is a member
  const userTeams = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id));

  let teamCalendarIds: string[] = [];
  if (userTeams.length > 0) {
    const teamIds = userTeams.map((t) => t.teamId);
    const teamCals = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(
        and(
          eq(calendars.type, "team"),
          inArray(calendars.ownerTeamId, teamIds),
          // Une équipe appartient à une organisation : son calendrier ne se
          // montre que sur le sous-domaine de celle-ci.
          eq(calendars.organizationId, orgId)
        )
      );
    teamCalendarIds = teamCals.map((c) => c.id);
  }

  const allIds = new Set([
    ...ownCalendars.map((c) => c.id),
    ...subs.map((s) => s.calendarId),
    ...orgCalendars.map((c) => c.id),
    ...teamCalendarIds,
  ]);

  return [...allIds];
}

/**
 * Determine the permission level for a user on a calendar.
 */
export async function getCalendarPermission(
  user: SessionUser,
  calendarId: string
): Promise<CalendarPermission | null> {
  // Le calendrier est chargé AVANT toute décision de rôle : sans lui, la
  // dispense du rôle global ne pourrait pas être bornée à son organisation.
  // Résidu du constat AZ-06 (audit du 2026-08-19) : la fonction rendait
  // "admin" sur n'importe quel calendrier de n'importe quelle organisation dès
  // que le rôle global valait `admin`, avant même de savoir si le calendrier
  // existait. Même geste que `getSpacePermission` : `super_admin`, qui
  // administre l'instance, garde la dispense inconditionnelle ; `admin` ne
  // l'obtient que dans une organisation dont il est membre.
  const calendar = await db
    .select()
    .from(calendars)
    .where(eq(calendars.id, calendarId))
    .limit(1);

  if (calendar.length === 0) return null;
  const cal = calendar[0];

  if (canCrossOrgBoundary(user.globalRole)) return "admin";
  // Vraie ligne d'appartenance exigée, comme `getSpacePermission` : sur
  // l'organisation partagée par défaut, `isOrgMember` répond toujours vrai, si
  // bien que la dispense y restait accordée à l'admin de n'importe quel tenant
  // isolé (complément d'ADR-079 du 2026-08-20). La lecture ordinaire des
  // calendriers d'organisation, plus bas, garde `isOrgMember` : elle relève de
  // l'ACCÈS au tenant, pas de son ADMINISTRATION.
  if (
    hasGlobalRole(user.globalRole, "admin") &&
    (await hasOrgMembershipRow(user.id, cal.organizationId))
  ) {
    return "admin";
  }

  if (cal.ownerUserId === user.id) return "admin";

  // Subscription
  const sub = await db
    .select()
    .from(calendarSubscriptions)
    .where(
      and(
        eq(calendarSubscriptions.calendarId, calendarId),
        eq(calendarSubscriptions.userId, user.id)
      )
    )
    .limit(1);

  if (sub.length > 0) return sub[0].permission;

  // Team membership
  if (cal.type === "team" && cal.ownerTeamId) {
    const membership = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, cal.ownerTeamId),
          eq(teamMembers.userId, user.id)
        )
      )
      .limit(1);

    if (membership.length > 0) {
      return membership[0].role === "admin" ? "admin" : "write";
    }
  }

  // Organization : lecture réservée aux membres de l'org du calendrier.
  if (cal.type === "organization" && (await isOrgMember(user.id, cal.organizationId))) {
    return "read";
  }

  return null;
}
