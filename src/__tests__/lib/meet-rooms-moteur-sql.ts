/**
 * Petit moteur relationnel en mémoire, au service de
 * `meet-rooms-org-scope.test.ts`.
 *
 * Il n'a pas vocation à comprendre SQL en général : il exécute les quelques
 * formes que `drizzle` produit pour les chargements de réunions (projection de
 * colonnes qualifiées, jointure interne ou externe sur une égalité, clause
 * `where` faite d'égalités, de `and`, de `or` et d'un `in (select ...)` sur les
 * participants, tri et limite). Son intérêt est de faire réellement passer la
 * requête compilée sur un jeu de données, plutôt que de se contenter de rendre
 * des lignes décidées à l'avance : une réunion absente du résultat l'est parce
 * que la requête l'exclut.
 */

export const ORG_ACME = "org-acme";
export const ORG_VICTIME = "org-victime";
export const UTILISATEUR = "utilisateur-1";

type Ligne = Record<string, unknown>;

function reunion(champs: Ligne): Ligne {
  return {
    title: "Réunion",
    documentId: null,
    notesDocumentId: null,
    status: "ended",
    egressId: null,
    recordingPath: null,
    transcriptPath: null,
    meetingType: "video",
    participants: null,
    speakerMapping: null,
    startedAt: "2026-08-20 10:00:00",
    endedAt: "2026-08-20 11:00:00",
    scheduledAt: null,
    calendarEventId: null,
    createdBy: UTILISATEUR,
    createdAt: "2026-08-20 09:00:00",
    updatedAt: "2026-08-20 09:00:00",
    ...champs,
  };
}

export const donnees = {
  spaces: [
    { id: "espace-acme", organizationId: ORG_ACME, slug: "acme", name: "Acme" },
    { id: "espace-victime", organizationId: ORG_VICTIME, slug: "victime", name: "Victime" },
  ] as Ligne[],
  meetings: [
    reunion({ id: "reunion-acme", roomName: "salle-acme", spaceId: "espace-acme" }),
    reunion({
      id: "reunion-acme-invitee",
      roomName: "salle-acme-invitee",
      spaceId: "espace-acme",
      // Créée par un tiers : l'utilisateur ne la voit que par sa participation.
      createdBy: "utilisateur-2",
    }),
    reunion({ id: "reunion-victime", roomName: "salle-victime", spaceId: "espace-victime" }),
    // Espace supprimé : `onDelete: set null` a laissé la réunion sans espace.
    reunion({ id: "reunion-orpheline", roomName: "salle-orpheline", spaceId: null }),
  ] as Ligne[],
  meeting_participants: [
    { id: "part-1", meetingId: "reunion-acme-invitee", userId: UTILISATEUR },
  ] as Ligne[],
};

/** `room_name` → `roomName`. */
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
    // `"t"."c" in (select "meeting_id" from "meeting_participants" where ... = $n)`
    const sousRequete = this.consomme(
      /"(\w+)"\."(\w+)" in \(select "(\w+)" from "(\w+)" where "(\w+)"\."(\w+)" = \$(\d+)\)/
    );
    if (sousRequete) {
      const [, table, colonne, projetee, tableSource, , colonneFiltre, indice] = sousRequete;
      const attendue = this.params[Number(indice) - 1];
      const ensemble = new Set(
        (donnees[tableSource as keyof typeof donnees] as Ligne[])
          .filter((l) => l[versCamel(colonneFiltre)] === attendue)
          .map((l) => l[versCamel(projetee)])
      );
      return (ligne) => ensemble.has(valeur(ligne, table, colonne));
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

/**
 * Exécute la requête compilée et rend les lignes au format attendu par
 * `drizzle-orm/pg-proxy` : un tableau de tableaux, dans l'ordre de projection.
 */
export function executerSql(sqlBrut: string, params: unknown[]): unknown[][] {
  const sql = sqlBrut.replace(/\s+/g, " ").trim();

  const entete = sql.match(/^select (.+?) from "(\w+)"/);
  if (!entete) throw new Error(`Requête non reconnue : ${sql}`);
  const tablePrincipale = entete[2];
  const projection = entete[1].split(", ").map((item) => {
    const qualifiee = item.match(/^"(\w+)"\."(\w+)"$/);
    if (qualifiee) return { table: qualifiee[1], colonne: qualifiee[2] };
    // `select()` sans jointure projette des colonnes non qualifiées.
    const nue = item.match(/^"(\w+)"$/);
    if (nue) return { table: tablePrincipale, colonne: nue[1] };
    throw new Error(`Colonne projetée non reconnue : ${item}`);
  });

  const jointure = sql.match(
    /(inner|left) join "(\w+)" on "(\w+)"\."(\w+)" = "(\w+)"\."(\w+)"/
  );

  const clauseWhere = sql.match(/ where (.+?)(?: order by | limit |$)/);
  const predicat = clauseWhere
    ? new Analyseur(clauseWhere[1], params).analyser()
    : () => true;

  const tri = sql.match(/ order by "(\w+)"\."(\w+)" (asc|desc)/);
  const limite = sql.match(/ limit \$(\d+)/);

  let lignes: LigneJointe[] = (
    donnees[tablePrincipale as keyof typeof donnees] as Ligne[]
  ).map((l) => ({ [tablePrincipale]: l }));

  if (jointure) {
    const [, type, tableJointe, tGauche, cGauche, tDroite, cDroite] = jointure;
    const sourceJointe = donnees[tableJointe as keyof typeof donnees] as Ligne[];
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
