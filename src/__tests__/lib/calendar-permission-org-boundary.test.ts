/**
 * Non-régression : résidu du constat AZ-06 dans le calendrier.
 *
 * `getCalendarPermission` rendait "admin" dès que le rôle global valait
 * `admin`, AVANT même de charger le calendrier, donc sans qu'aucun filtre
 * d'organisation soit possible. Un admin d'une organisation obtenait ainsi
 * l'administration de n'importe quel calendrier de n'importe quel tenant.
 *
 * Le calendrier est désormais chargé d'abord, et la dispense du rôle global
 * est bornée à son organisation, comme dans `getSpacePermission` : seul
 * `super_admin`, qui administre l'instance, franchit encore la frontière.
 *
 * Le test exerce la VRAIE fonction, avec un faux client Drizzle qui rend le
 * calendrier demandé puis des résultats vides pour les chemins d'accès
 * suivants (abonnement, équipe), afin qu'aucun autre chemin ne masque le
 * comportement testé.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  calendrier: null as Record<string, unknown> | null,
  appels: { count: 0 },
  membreDe: [] as string[],
  utilisateurCourant: "",
}));

vi.mock("@/lib/db", () => {
  function chain() {
    // 1re requête : le calendrier. Les suivantes (abonnement, appartenance
    // d'équipe) rendent vide, pour isoler la décision de rôle.
    const rows = h.appels.count === 0 && h.calendrier ? [h.calendrier] : [];
    h.appels.count += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
      where: () => self,
      innerJoin: () => self,
      orderBy: () => self,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  }
  return { db: { select: () => chain() } };
});

// `membreDe` énumère de VRAIES lignes `organization_members` : les deux
// fonctions se doublent donc de la même façon ici. Elles ne diffèrent que sur
// l'organisation partagée par défaut, qu'aucun cas de ce fichier n'emploie ;
// cette différence est exercée par `calendar-org-confinement.test.ts`.
vi.mock("@/lib/org/resolve-request-org", () => ({
  isOrgMember: async (userId: string, orgId: string | null | undefined) =>
    userId === h.utilisateurCourant && !!orgId && h.membreDe.includes(orgId),
  hasOrgMembershipRow: async (userId: string, orgId: string | null | undefined) =>
    userId === h.utilisateurCourant && !!orgId && h.membreDe.includes(orgId),
}));

import { getCalendarPermission } from "@/lib/calendar/permissions";
import type { SessionUser } from "@/types";

const ORG_ACME = "org-acme";
const ORG_VICTIME = "org-victime";

function utilisateur(id: string, globalRole: string): SessionUser {
  return { id, email: `${id}@test.tld`, globalRole } as unknown as SessionUser;
}

/** Calendrier personnel d'un tiers : aucun autre chemin d'accès possible. */
function calendrierDe(organizationId: string) {
  return {
    id: "cal-1",
    organizationId,
    ownerUserId: "quelquun-dautre",
    ownerTeamId: null,
    type: "personal",
  };
}

async function permission(user: SessionUser) {
  h.appels.count = 0;
  h.utilisateurCourant = user.id;
  return getCalendarPermission(user, "cal-1");
}

beforeEach(() => {
  h.calendrier = null;
  h.appels.count = 0;
  h.membreDe = [ORG_ACME];
});

describe("getCalendarPermission — dispense du rôle global bornée à l'organisation", () => {
  it("n'accorde RIEN à un admin global sur le calendrier d'une organisation dont il n'est pas membre", async () => {
    h.calendrier = calendrierDe(ORG_VICTIME);

    expect(await permission(utilisateur("admin-acme", "admin"))).toBeNull();
  });

  it("accorde toujours admin à un admin global dans SON organisation", async () => {
    h.calendrier = calendrierDe(ORG_ACME);

    expect(await permission(utilisateur("admin-acme", "admin"))).toBe("admin");
  });

  it("conserve le franchissement à super_admin, qui administre l'instance", async () => {
    h.calendrier = calendrierDe(ORG_VICTIME);

    expect(await permission(utilisateur("super", "super_admin"))).toBe("admin");
  });

  it("rend null sur un calendrier inexistant, sans jamais accorder par le rôle", async () => {
    h.calendrier = null;

    expect(await permission(utilisateur("admin-acme", "admin"))).toBeNull();
    expect(await permission(utilisateur("super", "super_admin"))).toBeNull();
  });

  it("ne change rien pour un utilisateur ordinaire sans aucun chemin d'accès", async () => {
    h.calendrier = calendrierDe(ORG_ACME);

    expect(await permission(utilisateur("membre", "editor"))).toBeNull();
  });
});
