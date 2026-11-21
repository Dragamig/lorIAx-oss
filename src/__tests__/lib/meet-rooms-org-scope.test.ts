/**
 * Cloisonnement du module visio : `getMeetingInOrg`, `getMeetingByRoomNameInOrg`
 * et `listMeetings` (constat AZ-09 de l'audit du 2026-08-19).
 *
 * Avant le lot, ces trois chargements ne portaient aucun filtre d'organisation :
 * un identifiant de réunion, ou un simple nom de salle, suffisait à lire une
 * réunion d'un autre tenant, et la liste remontait les réunions toutes
 * organisations confondues.
 *
 * Les suites d'API du module remplacent `@/lib/meet/rooms` par un mock qui
 * réimplémente lui-même le filtre : elles ne prouvent donc rien sur la vraie
 * fonction. Ce fichier exerce le VRAI module.
 *
 * Le faux client est un `drizzle` monté sur `pg-proxy` : la requête est
 * réellement compilée en SQL, et un petit moteur relationnel l'exécute sur un
 * jeu de données en mémoire. On peut donc à la fois inspecter la jointure et
 * les conditions soumises, et constater ce qui est effectivement rendu.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  requetes: [] as { sql: string; params: unknown[] }[],
}));

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const schema = await import("@/lib/db/schema");
  // Le moteur est défini dans la fabrique : `vi.mock` est hissé au-dessus des
  // imports du fichier, rien du module courant n'est encore évalué ici.
  const { executerSql } = await import("./meet-rooms-moteur-sql");
  const db = drizzle(
    async (sql: string, params: unknown[]) => {
      h.requetes.push({ sql, params });
      return { rows: executerSql(sql, params) };
    },
    { schema }
  );
  return { db };
});

import {
  getMeetingInOrg,
  getMeetingByRoomNameInOrg,
  getMeetingUnscoped,
  listMeetings,
} from "@/lib/meet/rooms";
import { donnees, ORG_ACME, ORG_VICTIME, UTILISATEUR } from "./meet-rooms-moteur-sql";

/** SQL de la dernière requête soumise, espaces normalisés. */
function dernierSql(): string {
  const derniere = h.requetes[h.requetes.length - 1];
  expect(derniere).toBeDefined();
  return derniere.sql.replace(/\s+/g, " ");
}

/** Paramètres de la dernière requête soumise. */
function derniersParams(): unknown[] {
  return h.requetes[h.requetes.length - 1].params;
}

beforeEach(() => {
  h.requetes.length = 0;
});

describe("getMeetingInOrg : jointure et conditions réellement soumises", () => {
  it("joint `spaces` et borne l'organisation au paramètre reçu", async () => {
    await getMeetingInOrg("reunion-acme", ORG_ACME);

    const sql = dernierSql();
    // La jointure interne sur `spaces` est la seule source d'organisation :
    // la table `meetings` n'en porte pas.
    expect(sql).toContain('inner join "spaces"');
    expect(sql).toContain('"spaces"."id" = "meetings"."space_id"');
    // L'organisation demandée est bien une condition de la requête.
    expect(sql).toContain('"spaces"."organization_id" =');
    expect(derniersParams()).toContain(ORG_ACME);
    // Et jamais une jointure externe, qui laisserait passer les orphelines.
    expect(sql).not.toContain("left join");
  });
});

describe("getMeetingInOrg : ce qui est rendu", () => {
  it("rend la réunion demandée dans son organisation", async () => {
    const reunion = await getMeetingInOrg("reunion-acme", ORG_ACME);
    expect(reunion?.id).toBe("reunion-acme");
  });

  it("ne rend pas une réunion d'une autre organisation", async () => {
    await expect(getMeetingInOrg("reunion-victime", ORG_ACME)).resolves.toBeNull();
  });

  it("rend bien cette même réunion depuis son organisation d'origine", async () => {
    // Témoin : la ligne existe dans le jeu de données et est atteignable. Le
    // `null` du test précédent vient donc du filtre, pas d'une base vide.
    const reunion = await getMeetingInOrg("reunion-victime", ORG_VICTIME);
    expect(reunion?.id).toBe("reunion-victime");
  });

  it("ne rend pas une réunion orpheline, dont l'espace a été supprimé (fail-closed assumé)", async () => {
    // `meetings.space_id` est nullable (`onDelete: set null`) : une réunion sans
    // espace n'est rattachable à aucune organisation. La jointure interne la
    // rend invisible depuis tout chemin authentifié. C'est un choix documenté,
    // testé ici pour qu'il reste un choix.
    await expect(getMeetingInOrg("reunion-orpheline", ORG_ACME)).resolves.toBeNull();
    await expect(getMeetingInOrg("reunion-orpheline", ORG_VICTIME)).resolves.toBeNull();
  });

  it("rend bien cette orpheline par le chargement explicitement non cloisonné", async () => {
    // Témoin : le chemin réservé aux tâches de fond la voit toujours. Son
    // absence plus haut vient du cloisonnement, pas d'un jeu de données vide.
    const reunion = await getMeetingUnscoped("reunion-orpheline");
    expect(reunion?.id).toBe("reunion-orpheline");
  });
});

describe("getMeetingByRoomNameInOrg : même règle par nom de salle", () => {
  it("joint `spaces` et borne l'organisation au paramètre reçu", async () => {
    await getMeetingByRoomNameInOrg("salle-acme", ORG_ACME);

    const sql = dernierSql();
    expect(sql).toContain('inner join "spaces"');
    expect(sql).toContain('"spaces"."organization_id" =');
    expect(derniersParams()).toContain(ORG_ACME);
    expect(sql).not.toContain("left join");
  });

  it("rend la réunion de son organisation", async () => {
    const reunion = await getMeetingByRoomNameInOrg("salle-acme", ORG_ACME);
    expect(reunion?.id).toBe("reunion-acme");
  });

  it("ne rend pas la salle d'une autre organisation", async () => {
    await expect(
      getMeetingByRoomNameInOrg("salle-victime", ORG_ACME)
    ).resolves.toBeNull();
  });

  it("rend bien cette salle depuis son organisation d'origine", async () => {
    const reunion = await getMeetingByRoomNameInOrg("salle-victime", ORG_VICTIME);
    expect(reunion?.id).toBe("reunion-victime");
  });

  it("ne rend pas la salle d'une réunion orpheline", async () => {
    await expect(
      getMeetingByRoomNameInOrg("salle-orpheline", ORG_ACME)
    ).resolves.toBeNull();
  });
});

describe("listMeetings : la même règle, pas une seconde", () => {
  it("joint `spaces` et borne l'organisation au paramètre reçu", async () => {
    await listMeetings(UTILISATEUR, ORG_ACME);

    const sql = dernierSql();
    expect(sql).toContain('inner join "spaces"');
    expect(sql).toContain('"spaces"."organization_id" =');
    expect(derniersParams()).toContain(ORG_ACME);
    expect(sql).not.toContain("left join");
  });

  it("ne remonte que les réunions de l'organisation demandée", async () => {
    const liste = await listMeetings(UTILISATEUR, ORG_ACME);
    const ids = liste.map((r) => r.id).sort();

    // Créée par l'utilisateur, et réunion à laquelle il a seulement participé :
    // les deux chemins de la clause `or` restent ouverts dans son organisation.
    expect(ids).toEqual(["reunion-acme", "reunion-acme-invitee"]);
    expect(ids).not.toContain("reunion-victime");
    expect(ids).not.toContain("reunion-orpheline");
  });

  it("remonte bien la réunion de l'autre organisation depuis cette organisation", async () => {
    // Témoin : même utilisateur, même jeu de données, seule l'organisation de
    // la requête change.
    const liste = await listMeetings(UTILISATEUR, ORG_VICTIME);
    expect(liste.map((r) => r.id)).toEqual(["reunion-victime"]);
  });

  it("applique exactement la règle du chargement par identifiant", async () => {
    // Propriété de cohérence : pour chaque réunion du jeu de données et chaque
    // organisation, « visible dans la liste » équivaut à « chargeable par
    // identifiant ». Aucune des deux fonctions n'invente sa propre frontière.
    for (const orgId of [ORG_ACME, ORG_VICTIME]) {
      const liste = await listMeetings(UTILISATEUR, orgId);
      const visibles = new Set(liste.map((r) => r.id));
      for (const reunion of donnees.meetings) {
        const identifiant = String(reunion.id);
        const parIdentifiant = await getMeetingInOrg(identifiant, orgId);
        expect(visibles.has(identifiant)).toBe(parIdentifiant !== null);
      }
    }
  });
});
