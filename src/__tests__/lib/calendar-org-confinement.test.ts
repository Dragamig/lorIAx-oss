/**
 * Cloisonnement multi-tenant du calendrier : `checkCalendarAccess`,
 * `getAccessibleCalendarIds` et la voie CalDAV.
 *
 * Le lot 6 a rendu l'organisation explicite et obligatoire partout où une
 * décision d'accès en dépend (`getMeetingInOrg`, `checkVisioPermission`,
 * `listMeetings`, ADR-079). Le calendrier était resté en retrait, sur trois
 * points que ces tests ferment :
 *
 * 1. `checkCalendarAccess` recevait l'organisation en paramètre OPTIONNEL, et
 *    ne l'appliquait que si elle était fournie ET que le calendrier en portait
 *    une. Sur 23 points d'appel, un seul la passait : les 22 autres sautaient
 *    intégralement le contrôle, et un `null` de `getRequestOrgId` valait
 *    « pas de filtre » au lieu de « pas d'accès ».
 * 2. Le rebranchement sur `getSpacePermission` a élargi l'accès aux
 *    calendriers d'espace ; l'élargissement est assumé, il est constaté ici.
 * 3. `getAccessibleCalendarIds` annonçait un filtre d'organisation sur tous
 *    les calendriers partagés, alors que les abonnements et les calendriers
 *    d'équipe n'en avaient aucun.
 *
 * Ces tests exercent les VRAIES fonctions. Le faux client est un `drizzle`
 * monté sur `pg-proxy` : la requête est réellement compilée en SQL, puis
 * exécutée sur un jeu de données en mémoire (même dispositif que
 * `meet-rooms-org-scope.test.ts`). Seule la résolution de l'organisation de la
 * requête HTTP est simulée, faute de contexte Next.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  requetes: [] as { sql: string; params: unknown[] }[],
  /** Organisation que rend `getRequestOrgId` sur la voie CalDAV. */
  orgDeLaRequete: null as string | null,
  /** Simule l'absence de contexte de requête Next (`headers()` jette). */
  horsContexte: false,
}));

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const schema = await import("@/lib/db/schema");
  const { executerSql } = await import("./calendar-org-moteur-sql");
  const db = drizzle(
    async (sql: string, params: unknown[]) => {
      h.requetes.push({ sql, params });
      return { rows: executerSql(sql, params) };
    },
    { schema }
  );
  return { db };
});

// Seule la lecture de l'en-tête de sous-domaine est simulée : elle suppose un
// contexte de requête Next qui n'existe pas en test. Tout le reste (contrôle
// d'appartenance, permissions d'espace, cloisonnement) est la vraie logique.
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(async () => {
    if (h.horsContexte) {
      throw new Error("`headers` was called outside a request scope.");
    }
    return h.orgDeLaRequete;
  }),
}));

import {
  checkCalendarAccess,
  getAccessibleCalendarIds,
  getCalendarPermission,
} from "@/lib/calendar/permissions";
import {
  parseCalDAVPath,
  handlePropfind,
  handleDeleteEvent,
} from "@/lib/calendar/caldav-server";
import {
  donnees,
  reinitialiserDonnees,
  ORG_ACME,
  ORG_DEFAUT,
  ORG_VICTIME,
  ALICE,
  DIANE,
  EVE,
  FRANK,
} from "./calendar-org-moteur-sql";
import type { SessionUser } from "@/types";

type Verbe = "read" | "write" | "admin";
const VERBES: Verbe[] = ["read", "write", "admin"];

const alice = {
  id: ALICE,
  email: "alice@test.tld",
  name: "Alice",
  globalRole: "editor",
  capabilities: [],
  avatarUrl: null,
} as unknown as SessionUser;

function compte(id: string, globalRole: string): SessionUser {
  return {
    id,
    email: `${id}@test.tld`,
    name: id,
    globalRole,
    capabilities: [],
    avatarUrl: null,
  } as unknown as SessionUser;
}

/** Admin global d'Acme, étrangère au tenant mutualisé. */
const diane = compte(DIANE, "admin");
/** Admin global réellement membre du tenant mutualisé. */
const eve = compte(EVE, "admin");
/** Administration d'instance. */
const frank = compte(FRANK, "super_admin");

function purger() {}

async function acces(calendarId: string, action: Verbe, orgId: string | null) {
  purger();
  return checkCalendarAccess(ALICE, calendarId, action, orgId);
}

/** Les trois verbes du calendrier, dans l'ordre lecture, écriture, admin. */
async function troisVerbes(calendarId: string, orgId: string | null) {
  const res: boolean[] = [];
  for (const verbe of VERBES) res.push(await acces(calendarId, verbe, orgId));
  return res;
}

beforeEach(() => {
  h.requetes.length = 0;
  h.orgDeLaRequete = null;
  h.horsContexte = false;
  reinitialiserDonnees();
  purger();
});

describe("checkCalendarAccess : un appelant d'une autre organisation est refusé", () => {
  it("refuse les trois verbes sur un calendrier d'organisation tiers, malgré un abonnement `admin`", async () => {
    // Alice est abonnée en `admin` à `cal-org-victime` et membre de
    // l'organisation victime : seul le sous-domaine interrogé change.
    expect(await troisVerbes("cal-org-victime", ORG_ACME)).toEqual([false, false, false]);
  });

  it("rend bien ces trois accès depuis l'organisation d'origine (témoin)", async () => {
    expect(await troisVerbes("cal-org-victime", ORG_VICTIME)).toEqual([true, true, true]);
  });

  it("refuse le calendrier d'équipe d'un autre tenant, bien qu'Alice soit dans cette équipe", async () => {
    expect(await troisVerbes("cal-equipe-victime", ORG_ACME)).toEqual([false, false, false]);
  });

  it("rend bien ce calendrier d'équipe depuis son organisation (témoin)", async () => {
    // Membre simple : lecture et écriture, jamais l'administration.
    expect(await troisVerbes("cal-equipe-victime", ORG_VICTIME)).toEqual([true, true, false]);
  });

  it("refuse le calendrier d'espace d'un autre tenant", async () => {
    expect(await troisVerbes("cal-espace-victime", ORG_ACME)).toEqual([false, false, false]);
  });

  it("refuse même le calendrier dont Alice est PROPRIÉTAIRE dans l'autre organisation", async () => {
    // Le filtre d'organisation précède la propriété : depuis le sous-domaine
    // d'Acme, un objet du tenant victime n'existe pas.
    expect(await troisVerbes("cal-alice-victime", ORG_ACME)).toEqual([false, false, false]);
    expect(await troisVerbes("cal-alice-victime", ORG_VICTIME)).toEqual([true, true, true]);
  });
});

describe("checkCalendarAccess : `null` vaut refus, jamais « pas de filtre »", () => {
  it("refuse tout quand l'organisation n'est pas résolue, y compris le calendrier personnel du demandeur", async () => {
    expect(await troisVerbes("cal-perso-alice", null)).toEqual([false, false, false]);
    expect(await troisVerbes("cal-org-acme", null)).toEqual([false, false, false]);
    expect(await troisVerbes("cal-equipe-acme", null)).toEqual([false, false, false]);
  });

  it("ne soumet aucune requête quand l'organisation est absente (refus avant toute lecture)", async () => {
    h.requetes.length = 0;
    await checkCalendarAccess(ALICE, "cal-org-acme", "read", null);
    expect(h.requetes).toHaveLength(0);
  });
});

describe("checkCalendarAccess : le calendrier personnel reste celui de son propriétaire", () => {
  it("laisse Alice maîtresse de son calendrier personnel, depuis n'importe quelle organisation", async () => {
    // Un calendrier personnel est org-neutre (`organization_id` NULL) : il
    // n'appartient à aucun tenant, le confiner à un seul le lui retirerait.
    expect(await troisVerbes("cal-perso-alice", ORG_ACME)).toEqual([true, true, true]);
    expect(await troisVerbes("cal-perso-alice", ORG_VICTIME)).toEqual([true, true, true]);
  });

  it("honore un abonnement en lecture sur le calendrier personnel d'un tiers, sans l'élargir", async () => {
    expect(await troisVerbes("cal-perso-bob", ORG_ACME)).toEqual([true, false, false]);
  });
});

describe("checkCalendarAccess : le membre d'équipe conserve son accès", () => {
  it("garde lecture et écriture au membre de l'équipe propriétaire, dans son organisation", async () => {
    expect(await troisVerbes("cal-equipe-acme", ORG_ACME)).toEqual([true, true, false]);
  });
});

describe("checkCalendarAccess : un calendrier sans organisation n'ouvre aucun repli partagé", () => {
  it("refuse un calendrier d'équipe resté sans organisation, même à un membre de l'équipe", async () => {
    // Les replis partagés (équipe, organisation, espace) qualifient tous une
    // appartenance à un tenant : un objet qui n'en a aucun ne peut pas les
    // ouvrir. Seuls les liens explicites (propriété, abonnement) traversent.
    expect(await troisVerbes("cal-equipe-orpheline", ORG_ACME)).toEqual([false, false, false]);
    expect(await troisVerbes("cal-equipe-orpheline", ORG_VICTIME)).toEqual([false, false, false]);
  });
});

describe("checkCalendarAccess : calendrier d'espace, élargissement assumé du lot", () => {
  it("accorde l'écriture à un membre de l'organisation sur le calendrier d'un espace `organization`", async () => {
    // Arbitrage : `GET /api/spaces` liste déjà ces espaces à tout membre de
    // l'organisation, et le produit y autorise la création de documents et de
    // bases. Le seuil de l'écriture n'est donc pas relevé. L'administration,
    // elle, reste au niveau `admin` (Alice n'est que `member`).
    expect(await troisVerbes("cal-espace-acme", ORG_ACME)).toEqual([true, true, false]);
  });
});

describe("getAccessibleCalendarIds : aucune fuite entre organisations", () => {
  it("ne remonte, depuis Acme, ni l'abonnement ni le calendrier d'équipe de l'autre tenant", async () => {
    const ids = await getAccessibleCalendarIds(alice, ORG_ACME);

    expect(new Set(ids)).toEqual(
      new Set(["cal-perso-alice", "cal-perso-bob", "cal-equipe-acme", "cal-org-acme"])
    );
    // Les trois fuites constatées : abonnement, calendrier d'équipe, et
    // calendrier possédé, tous rattachés à l'organisation victime.
    expect(ids).not.toContain("cal-org-victime");
    expect(ids).not.toContain("cal-equipe-victime");
    expect(ids).not.toContain("cal-alice-victime");
  });

  it("remonte bien ces mêmes calendriers depuis l'organisation victime (témoin)", async () => {
    const ids = await getAccessibleCalendarIds(alice, ORG_VICTIME);

    expect(new Set(ids)).toEqual(
      new Set([
        "cal-perso-alice",
        "cal-perso-bob",
        "cal-equipe-victime",
        "cal-org-victime",
        "cal-alice-victime",
      ])
    );
  });

  it("applique exactement la règle de `checkCalendarAccess` (rien de listé qui serait ensuite refusé)", async () => {
    for (const orgId of [ORG_ACME, ORG_VICTIME]) {
      const ids = await getAccessibleCalendarIds(alice, orgId);
      for (const id of ids) {
        expect(await acces(id, "read", orgId)).toBe(true);
      }
    }
  });
});

describe("voie CalDAV : elle obtient son organisation du sous-domaine, sans repli permissif", () => {
  const cheminCalendrierVictime = parseCalDAVPath([ALICE, "org-victime"]);
  const cheminEvenementVictime = parseCalDAVPath([
    ALICE,
    "org-victime",
    "uid-victime@loriax.ics",
  ]);

  it("refuse la lecture d'un calendrier d'un autre tenant", async () => {
    h.orgDeLaRequete = ORG_ACME;
    const res = await handlePropfind(alice, cheminCalendrierVictime, "", "http://acme.test");
    expect(res.status).toBe(403);
  });

  it("rend bien ce calendrier depuis le sous-domaine de son organisation (témoin)", async () => {
    h.orgDeLaRequete = ORG_VICTIME;
    const res = await handlePropfind(alice, cheminCalendrierVictime, "", "http://victime.test");
    expect(res.status).toBe(207);
  });

  it("refuse tout quand l'organisation n'est pas résolvable (hors contexte de requête)", async () => {
    h.horsContexte = true;
    const res = await handlePropfind(alice, cheminCalendrierVictime, "", "http://acme.test");
    expect(res.status).toBe(403);
  });

  it("refuse la suppression d'un événement d'un autre tenant ET ne supprime rien", async () => {
    h.orgDeLaRequete = ORG_ACME;
    const res = await handleDeleteEvent(alice, cheminEvenementVictime);

    expect(res.status).toBe(403);
    // « Refuse ET ne fait rien » : la ligne est toujours là, et aucune
    // suppression n'a été soumise à la base.
    expect(donnees.calendar_events.map((e) => e.id)).toContain("evt-victime");
    expect(h.requetes.some((r) => /^\s*delete/i.test(r.sql))).toBe(false);
  });

  it("supprime bien cet événement depuis l'organisation d'origine (témoin)", async () => {
    h.orgDeLaRequete = ORG_VICTIME;
    const res = await handleDeleteEvent(alice, cheminEvenementVictime);

    expect(res.status).toBe(204);
    expect(donnees.calendar_events.map((e) => e.id)).not.toContain("evt-victime");
  });

  it("ne liste, dans le répertoire du compte, que les calendriers de l'organisation courante", async () => {
    h.orgDeLaRequete = ORG_ACME;
    const res = await handlePropfind(alice, parseCalDAVPath([ALICE, ""]), "", "http://acme.test");

    expect(res.status).toBe(207);
    // Le calendrier personnel (org-neutre) reste monté, celui de l'autre
    // tenant disparaît.
    expect(res.body).toContain("perso-alice");
    expect(res.body).not.toContain("alice-victime");
  });

  it("ne liste rien du tout quand l'organisation n'est pas résolue", async () => {
    h.orgDeLaRequete = null;
    const res = await handlePropfind(alice, parseCalDAVPath([ALICE, ""]), "", "http://acme.test");

    expect(res.status).toBe(207);
    expect(res.body).not.toContain("perso-alice");
    expect(res.body).not.toContain("alice-victime");
  });
});

/**
 * Complément d'ADR-079 du 2026-08-20 : « accès à une organisation » et
 * « administration d'une organisation » sont deux questions distinctes.
 * L'organisation partagée par défaut est ouverte à tout compte authentifié, si
 * bien qu'une dispense de rôle bornée par `isOrgMember` n'y borne RIEN : un
 * `admin` d'un tenant isolé y récupérait l'administration de tout, par le seul
 * domaine racine. Une dispense de rôle exige donc toujours une vraie ligne
 * `organization_members` (`hasOrgMembershipRow`).
 *
 * `getSpacePermission` avait été aligné dans le lot ; la branche calendrier ne
 * l'avait pas été, alors qu'elle a été relue et modifiée dans le même commit.
 * Ce que ces tests bornent est la DISPENSE DE RÔLE, et elle seule : l'accès
 * ordinaire au tenant mutualisé est une règle historique du produit, il est
 * constaté ici tel quel.
 */
describe("dispense de rôle : le tenant mutualisé n'est pas une dispense d'appartenance", () => {
  it("ne donne pas à l'admin d'un tenant isolé les calendriers du tenant mutualisé", async () => {
    const ids = await getAccessibleCalendarIds(diane, ORG_DEFAUT);

    // Le calendrier d'espace n'est joignable que par un lien explicite ou une
    // permission d'espace : Diane n'a ni l'un ni l'autre ici.
    expect(ids).not.toContain("cal-espace-defaut");
  });

  it("lui laisse l'accès ORDINAIRE au tenant mutualisé, qui n'est pas remis en cause", async () => {
    const ids = await getAccessibleCalendarIds(diane, ORG_DEFAUT);

    // Le calendrier d'organisation reste listé : c'est la règle historique
    // d'ouverture du tenant partagé, pas une dispense de rôle.
    expect(ids).toContain("cal-org-defaut");
  });

  it("ne lui accorde aucune permission sur ce calendrier d'espace", async () => {
    expect(await getCalendarPermission(diane, "cal-espace-defaut")).toBeNull();
    expect(await acces("cal-espace-defaut", "admin", ORG_DEFAUT)).toBe(false);
  });

  it("garde ses pouvoirs à l'admin qui est RÉELLEMENT membre du tenant (témoin)", async () => {
    expect(await getCalendarPermission(eve, "cal-espace-defaut")).toBe("admin");
    expect(await getAccessibleCalendarIds(eve, ORG_DEFAUT)).toContain(
      "cal-espace-defaut"
    );
  });

  it("laisse l'administration d'instance franchir sans condition (témoin)", async () => {
    // `super_admin` n'a aucune ligne d'appartenance, et doit tout obtenir :
    // c'est exactement la frontière posée par ADR-079.
    expect(await getCalendarPermission(frank, "cal-espace-defaut")).toBe("admin");
    expect(await getAccessibleCalendarIds(frank, ORG_DEFAUT)).toContain(
      "cal-espace-defaut"
    );
  });

  it("n'accorde pas davantage à l'admin d'un tenant isolé sur le calendrier d'un TIERS tenant", async () => {
    expect(await getCalendarPermission(diane, "cal-espace-victime")).toBeNull();
    expect(await getAccessibleCalendarIds(diane, ORG_VICTIME)).not.toContain(
      "cal-espace-victime"
    );
  });

  it("liste et contrôle disent la même chose sur le tenant où elle n'a pas la dispense", async () => {
    // Sur le tenant mutualisé, Diane ne porte aucune ligne d'appartenance :
    // elle passe par les mêmes branches ordinaires que n'importe quel compte,
    // et la liste ne peut donc plus annoncer un calendrier que la route
    // suivante refuserait.
    //
    // Cet invariant n'est PAS étendu à Acme, où elle a bien la dispense : la
    // branche dispensée de la liste rend tous les calendriers de
    // l'organisation, y compris ceux d'équipes dont l'admin n'est pas membre,
    // alors que `checkCalendarAccess` ne connaît aucune dispense de rôle.
    // Cette asymétrie est antérieure au lot et étrangère à la question
    // d'appartenance traitée ici ; la borner demanderait de trancher ce que la
    // dispense doit valoir sur un calendrier d'équipe, hors périmètre.
    for (const id of await getAccessibleCalendarIds(diane, ORG_DEFAUT)) {
      expect(await checkCalendarAccess(DIANE, id, "read", ORG_DEFAUT)).toBe(true);
    }
  });
});
