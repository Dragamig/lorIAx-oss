/**
 * Petit moteur relationnel en mémoire, au service de
 * `calendar-org-confinement.test.ts`.
 *
 * Même forme que `meet-rooms-moteur-sql.ts`, écrit pour le correctif de la
 * liste des réunions (1.99.9) : la requête `drizzle` est réellement compilée
 * en SQL, puis exécutée sur un jeu de données en mémoire. Un calendrier absent
 * d'un résultat l'est donc parce que la requête l'exclut, jamais parce qu'un
 * faux client avait décidé de le retirer.
 *
 * Il n'a pas vocation à comprendre SQL en général : il exécute les formes que
 * produisent `checkCalendarAccess`, `getAccessibleCalendarIds`,
 * `getSpacePermission`, `isOrgMember` et les gestionnaires CalDAV (projection
 * qualifiée ou non, jointure interne, `where` fait d'égalités, de `is null`,
 * de `in (...)`, de `and`/`or`, tri, limite, et suppression avec `returning`).
 */

export const ORG_DEFAUT = "org-defaut";
export const ORG_ACME = "org-acme";
export const ORG_VICTIME = "org-victime";

export const ALICE = "alice";
export const BOB = "bob";
export const CAROL = "carol";
/** Admin global d'un tenant ISOLÉ : aucune ligne d'appartenance au tenant mutualisé. */
export const DIANE = "diane";
/** Admin global RÉELLEMENT membre du tenant mutualisé. */
export const EVE = "eve";
/** Administration d'instance : franchit les frontières sans condition. */
export const FRANK = "frank";

export const EQUIPE_ACME = "equipe-acme";
export const EQUIPE_VICTIME = "equipe-victime";

type Ligne = Record<string, unknown>;

/** Calendrier complet : `select()` sans projection lit toutes les colonnes. */
function calendrier(champs: Ligne): Ligne {
  return {
    name: "Calendrier",
    description: null,
    color: "#3b82f6",
    timezone: "Europe/Paris",
    type: "personal",
    ownerUserId: null,
    ownerTeamId: null,
    spaceId: null,
    organizationId: null,
    isDefault: false,
    createdAt: "2026-08-20 09:00:00",
    updatedAt: "2026-08-20 09:00:00",
    ...champs,
  };
}

function evenement(champs: Ligne): Ligne {
  return {
    title: "Événement",
    description: null,
    location: null,
    startAt: "2026-08-21 10:00:00",
    endAt: "2026-08-21 11:00:00",
    allDay: false,
    recurrenceRule: null,
    recurrenceId: null,
    parentEventId: null,
    status: "confirmed",
    visibility: "public",
    color: null,
    progress: 0,
    documentId: null,
    meetingId: null,
    sequence: 0,
    createdBy: CAROL,
    createdAt: "2026-08-20 09:00:00",
    updatedAt: "2026-08-20 09:00:00",
    ...champs,
  };
}

/**
 * Jeu de données. Alice est réellement membre des DEUX organisations isolées :
 * ce qui doit trancher est l'organisation de la requête, pas son appartenance.
 */
export const donnees: Record<string, Ligne[]> = {
  organizations: [
    // La plus ancienne organisation active est l'organisation partagée par
    // défaut (`getDefaultOrgId`), celle qu'`isOrgMember` ouvre à tout compte.
    { id: ORG_DEFAUT, slug: "default", isActive: true, createdAt: "2020-01-01 00:00:00" },
    { id: ORG_ACME, slug: "acme", isActive: true, createdAt: "2026-01-01 00:00:00" },
    { id: ORG_VICTIME, slug: "victime", isActive: true, createdAt: "2026-02-01 00:00:00" },
  ],
  users: [
    { id: ALICE, globalRole: "editor" },
    { id: BOB, globalRole: "editor" },
    { id: CAROL, globalRole: "editor" },
    { id: DIANE, globalRole: "admin" },
    { id: EVE, globalRole: "admin" },
    { id: FRANK, globalRole: "super_admin" },
  ],
  organization_members: [
    { id: "om-1", organizationId: ORG_ACME, userId: ALICE, role: "member" },
    { id: "om-2", organizationId: ORG_VICTIME, userId: ALICE, role: "member" },
    // Diane administre Acme, et Acme seule : rien ne la rattache au tenant
    // mutualisé, où `isOrgMember` répond pourtant toujours vrai.
    { id: "om-3", organizationId: ORG_ACME, userId: DIANE, role: "admin" },
    { id: "om-4", organizationId: ORG_DEFAUT, userId: EVE, role: "admin" },
  ],
  teams: [
    { id: EQUIPE_ACME, organizationId: ORG_ACME, name: "Équipe Acme" },
    { id: EQUIPE_VICTIME, organizationId: ORG_VICTIME, name: "Équipe Victime" },
  ],
  team_members: [
    { id: "tm-1", teamId: EQUIPE_ACME, userId: ALICE, role: "member" },
    { id: "tm-2", teamId: EQUIPE_VICTIME, userId: ALICE, role: "member" },
  ],
  spaces: [
    {
      id: "espace-defaut",
      slug: "espace-defaut",
      name: "Espace du tenant mutualisé",
      type: "organization",
      classification: "internal",
      ownerUserId: null,
      ownerTeamId: null,
      organizationId: ORG_DEFAUT,
    },
    {
      id: "espace-acme",
      slug: "espace-acme",
      name: "Espace Acme",
      type: "organization",
      classification: "internal",
      ownerUserId: null,
      ownerTeamId: null,
      organizationId: ORG_ACME,
    },
    {
      id: "espace-victime",
      slug: "espace-victime",
      name: "Espace Victime",
      type: "organization",
      classification: "internal",
      ownerUserId: null,
      ownerTeamId: null,
      organizationId: ORG_VICTIME,
    },
  ],
  space_permissions: [],
  calendars: [
    // Personnel d'Alice : org-neutre par construction.
    calendrier({
      id: "cal-perso-alice",
      caldavSlug: "perso-alice",
      ownerUserId: ALICE,
    }),
    // Personnel de Bob, auquel Alice est abonnée en lecture : org-neutre lui aussi.
    calendrier({ id: "cal-perso-bob", caldavSlug: "perso-bob", ownerUserId: BOB }),
    // Calendrier d'équipe de chaque organisation : Alice est dans les deux équipes.
    calendrier({
      id: "cal-equipe-acme",
      caldavSlug: "equipe-acme",
      type: "team",
      ownerTeamId: EQUIPE_ACME,
      organizationId: ORG_ACME,
    }),
    calendrier({
      id: "cal-equipe-victime",
      caldavSlug: "equipe-victime",
      type: "team",
      ownerTeamId: EQUIPE_VICTIME,
      organizationId: ORG_VICTIME,
    }),
    // Anomalie de données : calendrier d'équipe resté sans organisation. Aucun
    // repli partagé ne doit s'y appliquer (fail-closed).
    calendrier({
      id: "cal-equipe-orpheline",
      caldavSlug: "equipe-orpheline",
      type: "team",
      ownerTeamId: EQUIPE_ACME,
      organizationId: null,
    }),
    // Calendrier d'organisation de chaque tenant.
    calendrier({
      id: "cal-org-acme",
      caldavSlug: "org-acme",
      type: "organization",
      organizationId: ORG_ACME,
    }),
    calendrier({
      id: "cal-org-victime",
      caldavSlug: "org-victime",
      type: "organization",
      organizationId: ORG_VICTIME,
    }),
    // Calendrier rattaché à un espace de type `organization` (défaut 2).
    calendrier({
      id: "cal-espace-acme",
      caldavSlug: "espace-acme",
      ownerUserId: CAROL,
      spaceId: "espace-acme",
      organizationId: ORG_ACME,
    }),
    calendrier({
      id: "cal-espace-victime",
      caldavSlug: "espace-victime",
      ownerUserId: CAROL,
      spaceId: "espace-victime",
      organizationId: ORG_VICTIME,
    }),
    // Tenant mutualisé (domaine racine), où se trouvent les vraies données.
    // Un calendrier d'organisation, ouvert par la règle historique d'accès…
    calendrier({
      id: "cal-org-defaut",
      caldavSlug: "org-defaut",
      type: "organization",
      organizationId: ORG_DEFAUT,
    }),
    // …et un calendrier d'espace, qui ne l'est pas : il n'est joignable que par
    // un lien explicite ou par une permission d'espace.
    calendrier({
      id: "cal-espace-defaut",
      caldavSlug: "espace-defaut",
      ownerUserId: CAROL,
      spaceId: "espace-defaut",
      organizationId: ORG_DEFAUT,
    }),
    // Calendrier d'Alice créé dans l'organisation victime : elle en est
    // propriétaire, il ne doit pas pour autant se montrer sur le sous-domaine
    // d'Acme.
    calendrier({
      id: "cal-alice-victime",
      caldavSlug: "alice-victime",
      ownerUserId: ALICE,
      type: "organization",
      organizationId: ORG_VICTIME,
    }),
  ],
  calendar_subscriptions: [
    {
      id: "sub-1",
      calendarId: "cal-perso-bob",
      userId: ALICE,
      permission: "read",
      createdAt: "2026-08-20 09:00:00",
    },
    // Abonnement d'Alice à un calendrier de l'organisation victime : un lien
    // explicite, mais qui ne dispense pas du cloisonnement.
    {
      id: "sub-2",
      calendarId: "cal-org-victime",
      userId: ALICE,
      permission: "admin",
      createdAt: "2026-08-20 09:00:00",
    },
  ],
  calendar_events: [
    evenement({
      id: "evt-victime",
      calendarId: "cal-org-victime",
      uid: "uid-victime@loriax",
    }),
    evenement({
      id: "evt-acme",
      calendarId: "cal-org-acme",
      uid: "uid-acme@loriax",
    }),
  ],
};

/** Copie de travail, restaurée entre les tests par `reinitialiserDonnees`. */
const initial = JSON.stringify(donnees);

export function reinitialiserDonnees(): void {
  const frais = JSON.parse(initial) as Record<string, Ligne[]>;
  for (const table of Object.keys(donnees)) donnees[table] = frais[table];
}

/** `owner_user_id` → `ownerUserId`. */
function versCamel(colonne: string): string {
  return colonne.replace(/_([a-z])/g, (_t, c: string) => c.toUpperCase());
}

type LigneJointe = Record<string, Ligne | null>;

function valeur(ligne: LigneJointe, table: string, colonne: string): unknown {
  const source = ligne[table];
  if (!source) return null;
  const v = source[versCamel(colonne)];
  return v === undefined ? null : v;
}

/* ------------------------------------------------------------------ */
/* Analyse de la clause `where`                                        */
/* ------------------------------------------------------------------ */

type Predicat = (ligne: LigneJointe) => boolean;

class Analyseur {
  private i = 0;
  constructor(private readonly texte: string, private readonly params: unknown[]) {}

  private espaces() {
    while (this.i < this.texte.length && /\s/.test(this.texte[this.i])) this.i += 1;
  }

  private consomme(motif: RegExp): RegExpMatchArray | null {
    this.espaces();
    const ancre = new RegExp(`^(?:${motif.source})`, motif.flags);
    const m = this.texte.slice(this.i).match(ancre);
    if (!m) return null;
    this.i += m[0].length;
    return m;
  }

  analyser(): Predicat {
    const p = this.ou();
    this.espaces();
    if (this.i < this.texte.length) {
      throw new Error(`Clause where non reconnue à « ${this.texte.slice(this.i)} »`);
    }
    return p;
  }

  private ou(): Predicat {
    let gauche = this.et();
    for (;;) {
      if (!this.consomme(/or\b/)) return gauche;
      const droite = this.et();
      const g = gauche;
      gauche = (ligne) => g(ligne) || droite(ligne);
    }
  }

  private et(): Predicat {
    let gauche = this.atome();
    for (;;) {
      if (!this.consomme(/and\b/)) return gauche;
      const droite = this.atome();
      const g = gauche;
      gauche = (ligne) => g(ligne) && droite(ligne);
    }
  }

  private atome(): Predicat {
    // `"t"."c" is null` / `is not null`
    const estNul = this.consomme(/"(\w+)"\."(\w+)" is (not )?null/);
    if (estNul) {
      const [, table, colonne, negation] = estNul;
      return (ligne) =>
        negation ? valeur(ligne, table, colonne) !== null : valeur(ligne, table, colonne) === null;
    }

    // `"t"."c" in ($1, $2, ...)`
    const dansListe = this.consomme(/"(\w+)"\."(\w+)" in \(([^)]*)\)/);
    if (dansListe) {
      const [, table, colonne, liste] = dansListe;
      const attendues = liste
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const indice = item.match(/^\$(\d+)$/);
          if (!indice) throw new Error(`Élément de liste non reconnu : ${item}`);
          return this.params[Number(indice[1]) - 1];
        });
      return (ligne) => {
        const v = valeur(ligne, table, colonne);
        return v !== null && attendues.includes(v);
      };
    }

    const egalite = this.consomme(/"(\w+)"\."(\w+)" = \$(\d+)/);
    if (egalite) {
      const [, table, colonne, indice] = egalite;
      const attendue = this.params[Number(indice) - 1];
      // Égalité SQL : `null` n'est égal à rien, pas même à `null`.
      return (ligne) => {
        const v = valeur(ligne, table, colonne);
        return v !== null && v === attendue;
      };
    }

    if (this.consomme(/\(/)) {
      const interne = this.ou();
      if (!this.consomme(/\)/)) throw new Error("Parenthèse fermante attendue");
      return interne;
    }

    throw new Error(`Terme non reconnu à « ${this.texte.slice(this.i)} »`);
  }
}

/* ------------------------------------------------------------------ */
/* Exécution                                                           */
/* ------------------------------------------------------------------ */

function colonnesProjetees(
  liste: string,
  tablePrincipale: string
): { table: string; colonne: string }[] {
  return liste.split(", ").map((item) => {
    const qualifiee = item.match(/^"(\w+)"\."(\w+)"$/);
    if (qualifiee) return { table: qualifiee[1], colonne: qualifiee[2] };
    const nue = item.match(/^"(\w+)"$/);
    if (nue) return { table: tablePrincipale, colonne: nue[1] };
    throw new Error(`Colonne projetée non reconnue : ${item}`);
  });
}

/**
 * Exécute la requête compilée et rend les lignes au format attendu par
 * `drizzle-orm/pg-proxy` : un tableau de tableaux, dans l'ordre de projection.
 */
export function executerSql(sqlBrut: string, params: unknown[]): unknown[][] {
  const sql = sqlBrut.replace(/\s+/g, " ").trim();

  // ── Suppression (CalDAV DELETE) ───────────────────────────────────────────
  const suppression = sql.match(/^delete from "(\w+)" where (.+?)(?: returning (.+))?$/);
  if (suppression) {
    const [, table, clause, projection] = suppression;
    const predicat = new Analyseur(clause, params).analyser();
    const restantes: Ligne[] = [];
    const supprimees: Ligne[] = [];
    for (const ligne of donnees[table]) {
      if (predicat({ [table]: ligne })) supprimees.push(ligne);
      else restantes.push(ligne);
    }
    donnees[table] = restantes;
    if (!projection) return [];
    const colonnes = colonnesProjetees(projection, table);
    return supprimees.map((ligne) =>
      colonnes.map(({ table: t, colonne }) => valeur({ [t]: ligne }, t, colonne))
    );
  }

  const entete = sql.match(/^select (.+?) from "(\w+)"/);
  if (!entete) throw new Error(`Requête non reconnue : ${sql}`);
  const tablePrincipale = entete[2];
  const projection = colonnesProjetees(entete[1], tablePrincipale);

  const jointure = sql.match(
    /(inner|left) join "(\w+)" on "(\w+)"\."(\w+)" = "(\w+)"\."(\w+)"/
  );

  const clauseWhere = sql.match(/ where (.+?)(?: order by | limit |$)/);
  const predicat = clauseWhere
    ? new Analyseur(clauseWhere[1], params).analyser()
    : () => true;

  const tri = sql.match(/ order by "(\w+)"\."(\w+)" (asc|desc)/);
  const limite = sql.match(/ limit \$(\d+)/);

  const source = donnees[tablePrincipale];
  if (!source) throw new Error(`Table inconnue : ${tablePrincipale}`);
  let lignes: LigneJointe[] = source.map((l) => ({ [tablePrincipale]: l }));

  if (jointure) {
    const [, type, tableJointe, tGauche, cGauche, tDroite, cDroite] = jointure;
    const sourceJointe = donnees[tableJointe];
    const jointes: LigneJointe[] = [];
    for (const ligne of lignes) {
      const candidats = sourceJointe.filter((autre) => {
        const complete: LigneJointe = { ...ligne, [tableJointe]: autre };
        const g = valeur(complete, tGauche, cGauche);
        const d = valeur(complete, tDroite, cDroite);
        return g !== null && g === d;
      });
      if (candidats.length > 0) {
        for (const autre of candidats) jointes.push({ ...ligne, [tableJointe]: autre });
      } else if (type === "left") {
        jointes.push({ ...ligne, [tableJointe]: null });
      }
    }
    lignes = jointes;
  }

  lignes = lignes.filter((ligne) => predicat(ligne));

  if (tri) {
    const [, table, colonne, sens] = tri;
    lignes.sort((a, b) => {
      const va = String(valeur(a, table, colonne) ?? "");
      const vb = String(valeur(b, table, colonne) ?? "");
      return sens === "desc" ? vb.localeCompare(va) : va.localeCompare(vb);
    });
  }

  if (limite) {
    const n = Number(params[Number(limite[1]) - 1]);
    lignes = lignes.slice(0, n);
  }

  return lignes.map((ligne) =>
    projection.map(({ table, colonne }) => valeur(ligne, table, colonne))
  );
}
