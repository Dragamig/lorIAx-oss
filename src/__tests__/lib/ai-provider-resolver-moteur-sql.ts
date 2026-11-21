/**
 * Petit moteur relationnel en mémoire, au service de
 * `ai-provider-resolver-org-scope.test.ts`.
 *
 * Il n'ambitionne pas de comprendre SQL : il exécute les quelques formes que
 * `drizzle` produit pour la résolution d'un fournisseur d'IA (projection sur
 * une seule table, clause `where` faite d'égalités paramétrées, de `is null`,
 * de `and`, de `or` et de parenthèses, plus une limite). Son intérêt est de
 * faire réellement passer la requête compilée sur un jeu de données : un
 * fournisseur absent du résultat l'est parce que la requête l'exclut, pas
 * parce qu'une doublure a décidé de le taire.
 */

export const ORG_ACME = "org-acme";
export const ORG_VICTIME = "org-victime";
export const ORG_TIERS = "org-tiers";

type Ligne = Record<string, unknown>;

function fournisseur(champs: Ligne): Ligne {
  return {
    name: "fournisseur",
    displayName: "Fournisseur",
    apiBaseUrl: "https://exemple.test/v1",
    apiKeyEnc: null,
    defaultModel: "modele-par-defaut",
    isEnabled: true,
    isDefault: false,
    config: {},
    connectorType: "openai_compatible",
    pricing: null,
    icon: null,
    color: null,
    createdAt: "2026-08-20 09:00:00",
    updatedAt: "2026-08-20 09:00:00",
    organizationId: null,
    ...champs,
  };
}

function assignation(champs: Ligne): Ligne {
  return {
    model: "modele-assigne",
    fallbackProviderId: null,
    fallbackModel: null,
    timeoutSeconds: 30,
    maxRetries: 1,
    isEnabled: true,
    createdAt: "2026-08-20 09:00:00",
    updatedAt: "2026-08-20 09:00:00",
    ...champs,
  };
}

/**
 * Jeu de données mutable : chaque test compose la situation qu'il décrit, puis
 * `reinitialiser()` rétablit l'état nominal.
 */
export const donnees: {
  ai_providers: Ligne[];
  ai_model_assignments: Ligne[];
  organizations: Ligne[];
  /** Chaîne de dérivation des chemins différés : note → document → espace. */
  spaces: Ligne[];
  documents: Ligne[];
  voice_notes: Ligne[];
  user_databases: Ligne[];
} = {
  ai_providers: [],
  ai_model_assignments: [],
  organizations: [],
  spaces: [],
  documents: [],
  voice_notes: [],
  user_databases: [],
};

/** Espace, document, note et base d'un tenant, pour la dérivation de portée. */
export const ESPACE_ACME = "space-acme";
export const ESPACE_VICTIME = "space-victime";
export const DOCUMENT_ACME = "doc-acme";
export const DOCUMENT_VICTIME = "doc-victime";
export const NOTE_ACME = "note-acme";
export const NOTE_VICTIME = "note-victime";
export const BASE_ACME = "base-acme";

export const FOURNISSEUR_ACME = "prov-acme";
export const FOURNISSEUR_VICTIME = "prov-victime";
export const FOURNISSEUR_INSTANCE = "prov-instance";

export function reinitialiser() {
  donnees.ai_providers = [
    fournisseur({
      id: FOURNISSEUR_ACME,
      name: "acme",
      displayName: "Acme",
      organizationId: ORG_ACME,
      isDefault: true,
      apiBaseUrl: "https://acme.test/v1",
      defaultModel: "modele-acme",
    }),
    fournisseur({
      id: FOURNISSEUR_VICTIME,
      name: "victime",
      displayName: "Victime",
      organizationId: ORG_VICTIME,
      isDefault: true,
      apiBaseUrl: "https://victime.test/v1",
      defaultModel: "modele-victime",
    }),
    fournisseur({
      id: FOURNISSEUR_INSTANCE,
      name: "instance",
      displayName: "Instance",
      organizationId: null,
      isDefault: true,
      apiBaseUrl: "https://instance.test/v1",
      defaultModel: "modele-instance",
    }),
  ];
  donnees.ai_model_assignments = [];
  donnees.organizations = [
    { id: ORG_ACME, slug: "acme", name: "Acme", isActive: true },
    { id: ORG_VICTIME, slug: "victime", name: "Victime", isActive: true },
  ];
  donnees.spaces = [
    { id: ESPACE_ACME, name: "Acme", organizationId: ORG_ACME },
    { id: ESPACE_VICTIME, name: "Victime", organizationId: ORG_VICTIME },
  ];
  donnees.documents = [
    {
      id: DOCUMENT_ACME,
      title: "Note d'Acme",
      spaceId: ESPACE_ACME,
      filePath: "acme.md",
      contentText: "Contenu d'Acme",
    },
    {
      id: DOCUMENT_VICTIME,
      title: "Note de Victime",
      spaceId: ESPACE_VICTIME,
      filePath: "victime.md",
      contentText: "Contenu de Victime",
    },
  ];
  donnees.voice_notes = [
    { id: NOTE_ACME, documentId: DOCUMENT_ACME },
    { id: NOTE_VICTIME, documentId: DOCUMENT_VICTIME },
  ];
  donnees.user_databases = [{ id: BASE_ACME, spaceId: ESPACE_ACME }];
}

/** Ajoute une assignation de modèle pour un usage donné. */
export function assigner(champs: Ligne) {
  donnees.ai_model_assignments.push(assignation({ id: `asg-${champs.usageType}`, ...champs }));
}

/** `is_default` → `isDefault`. */
function versCamel(colonne: string): string {
  return colonne.replace(/_([a-z])/g, (_t, c: string) => c.toUpperCase());
}

function valeur(ligne: Ligne, colonne: string): unknown {
  const v = ligne[versCamel(colonne)];
  return v === undefined ? null : v;
}

type Predicat = (ligne: Ligne) => boolean;

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
    const estNul = this.consomme(/(?:"\w+"\.)?"(\w+)" is null/);
    if (estNul) {
      const colonne = estNul[1];
      return (ligne) => valeur(ligne, colonne) === null;
    }

    const egalite = this.consomme(/(?:"\w+"\.)?"(\w+)" = \$(\d+)/);
    if (egalite) {
      const [, colonne, indice] = egalite;
      const attendue = this.params[Number(indice) - 1];
      // Égalité SQL : `null` n'est égal à rien, pas même à `null`.
      return (ligne) => {
        const v = valeur(ligne, colonne);
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

/**
 * Exécute la requête compilée et rend les lignes au format attendu par
 * `drizzle-orm/pg-proxy` : un tableau de tableaux, dans l'ordre de projection.
 */
export function executerSql(sqlBrut: string, params: unknown[]): unknown[][] {
  const sql = sqlBrut.replace(/\s+/g, " ").trim();

  const entete = sql.match(/^select (.+?) from "(\w+)"/);
  if (!entete) throw new Error(`Requête non reconnue : ${sql}`);
  const table = entete[2];
  const projection = entete[1].split(", ").map((item) => {
    const m = item.match(/^(?:"\w+"\.)?"(\w+)"$/);
    if (!m) throw new Error(`Colonne projetée non reconnue : ${item}`);
    return m[1];
  });

  const clauseWhere = sql.match(/ where (.+?)(?: order by | limit |$)/);
  const predicat = clauseWhere ? new Analyseur(clauseWhere[1], params).analyser() : () => true;

  const source = donnees[table as keyof typeof donnees];
  if (!source) throw new Error(`Table inconnue : ${table}`);

  let lignes = source.filter(predicat);

  const limite = sql.match(/ limit \$(\d+)/);
  if (limite) lignes = lignes.slice(0, Number(params[Number(limite[1]) - 1]));

  return lignes.map((ligne) => projection.map((colonne) => valeur(ligne, colonne)));
}
