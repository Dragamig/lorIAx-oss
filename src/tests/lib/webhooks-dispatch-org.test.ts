/**
 * Cloisonnement par organisation de la diffusion des webhooks (lot 6).
 *
 * `doDispatch` sélectionnait les webhooks actifs sans aucune clause
 * d'organisation, et ne filtrait ensuite que sur l'espace, test qui ne
 * s'appliquait qu'aux webhooks déclarant un espace. Un webhook sans espace
 * captait donc les événements de TOUS les tenants de l'instance : identifiants
 * d'espace et de document, titres, et l'acteur avec son nom et son adresse
 * électronique. Canal d'exfiltration continu, ouvert à tout utilisateur
 * légitime disposant de la portée `webhooks`.
 *
 * Motif de vérification : la doublure de base de données n'ignore pas la clause
 * `where`, elle l'INTERPRÈTE. La condition drizzle est rendue en SQL réel via
 * `PgDialect`, et les lignes semées ne remontent que si la requête porte
 * effectivement une égalité sur `organization_id` avec l'organisation de
 * l'événement. Retirer la clause du code de production fait donc remonter les
 * lignes des autres organisations, et les tests virent au rouge sur une
 * assertion (le chemin de sortie est appelé), pas sur un plantage d'import.
 *
 * L'absence de livraison est prouvée par le non-appel de `fetch`, c'est-à-dire
 * du chemin de sortie réel de `safeExternalFetch` (non mocké ici, comme dans
 * `webhooks-dispatch-ssrf.test.ts`), et non par un simple compteur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  insertValues: vi.fn(),
  dnsLookup: vi.fn(),
}));

vi.mock("dns", () => ({ promises: { lookup: h.dnsLookup } }));

vi.mock("@/lib/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(() => ({ set: h.updateSet })),
    insert: vi.fn(() => ({ values: h.insertValues })),
  },
}));

import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";

const dialect = new PgDialect();

const ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ESPACE_A = "11111111-3333-4333-8333-111111111111";
const AUTRE_ESPACE_A = "22222222-3333-4333-8333-222222222222";

const ACTEUR = { id: "user-1", email: "u@exemple.tld", name: "Utilisatrice" };

type LigneWebhook = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  spaceId: string | null;
  organizationId: string | null;
  failureCount: number;
  active: boolean;
};

function webhook(partiel: Partial<LigneWebhook> & { id: string; url: string }): LigneWebhook {
  return {
    secret: "secret-du-webhook",
    events: ["document.created"],
    spaceId: null,
    organizationId: ORG_A,
    failureCount: 0,
    active: true,
    ...partiel,
  };
}

/** Webhook légitime de l'organisation A, sans espace : le cas nominal. */
const WH_A = webhook({ id: "wh-a", url: "https://203.0.113.10/a" });

/**
 * Webhook de l'organisation B, sans espace : c'est LE vecteur. Avant le
 * correctif, il recevait les événements de l'organisation A.
 */
const WH_B = webhook({ id: "wh-b", url: "https://203.0.113.20/b", organizationId: ORG_B });

/** Webhook de l'organisation A restreint à un espace. */
const WH_A_ESPACE = webhook({
  id: "wh-a-espace",
  url: "https://203.0.113.30/a-espace",
  spaceId: ESPACE_A,
});

/** Ligne historique antérieure à la colonne d'organisation : ne doit rien recevoir. */
const WH_ORPHELIN = webhook({
  id: "wh-orphelin",
  url: "https://203.0.113.40/orphelin",
  organizationId: null,
});

/**
 * Extrait l'organisation exigée par la condition `where`, en rendant la
 * condition drizzle en SQL paramétré. Rend `undefined` si la requête ne porte
 * aucune clause sur `organization_id` : c'est exactement l'état d'avant le
 * correctif, et la doublure rend alors toutes les lignes semées.
 */
function organisationExigee(condition: unknown): string | undefined {
  if (!condition) return undefined;
  const { sql, params } = dialect.sqlToQuery(condition as never);
  const trouve = /"organization_id"\s*=\s*\$(\d+)/.exec(sql);
  if (!trouve) return undefined;
  return params[Number(trouve[1]) - 1] as string;
}

/** Chaîne `select().from().where()...` thenable, dont le `where` est interprété. */
function chaineFiltrante(lignes: LigneWebhook[]) {
  let condition: unknown = null;
  const chaine: Record<string, unknown> = {
    from: vi.fn(() => chaine),
    where: vi.fn((c: unknown) => {
      condition = c;
      return chaine;
    }),
    limit: vi.fn(() => chaine),
    then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) => {
      const org = organisationExigee(condition);
      const resultat =
        org === undefined ? lignes : lignes.filter((l) => l.organizationId === org);
      return Promise.resolve(resultat).then(resoudre, rejeter);
    },
  };
  return chaine;
}

/** Chaîne simple, sans filtrage : sert au premier `select` (l'acteur). */
function chaineFixe(lignes: unknown[]) {
  const chaine: Record<string, unknown> = {
    from: vi.fn(() => chaine),
    where: vi.fn(() => chaine),
    limit: vi.fn(() => chaine),
    then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
      Promise.resolve(lignes).then(resoudre, rejeter),
  };
  return chaine;
}

/** Sème la table des webhooks : 1er `select` = acteur, 2e = webhooks. */
function semer(lignes: LigneWebhook[]) {
  vi.mocked(db.select).mockReset();
  vi.mocked(db.select)
    .mockReturnValueOnce(chaineFixe([ACTEUR]) as never)
    .mockReturnValueOnce(chaineFiltrante(lignes) as never);
}

/** URLs réellement atteintes par le chemin de sortie. */
function ciblesAtteintes(): string[] {
  return h.fetch.mock.calls.map((appel) => String((appel as [URL, RequestInit])[0]));
}

/**
 * Laisse les livraisons en vol se terminer. Aucune livraison attendue dans les
 * cas de refus : on ne peut donc pas s'appuyer sur `waitFor`, qui n'aurait
 * rien à attendre. On vide les files de micro-tâches, ce qui suffit puisque
 * `fetch` et la base sont des doublures résolues immédiatement.
 */
async function laisserRetomber() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue(new Response("ok", { status: 200 }));
  h.updateSet.mockReturnValue({ where: h.updateWhere });
  h.updateWhere.mockResolvedValue(undefined);
  h.insertValues.mockResolvedValue(undefined);
  h.dnsLookup.mockResolvedValue([{ address: "203.0.113.99", family: 4 }]);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("dispatchWebhookEvent — cloisonnement par organisation", () => {
  it("n'atteint jamais le point de terminaison d'un webhook d'une autre organisation", async () => {
    semer([WH_A, WH_B]);

    await dispatchWebhookEvent(
      "document.created",
      { spaceId: ESPACE_A, documentId: "doc-1", title: "Note confidentielle de A" },
      ACTEUR.id,
      ORG_A
    );

    await vi.waitFor(() => {
      expect(h.fetch).toHaveBeenCalled();
    });
    await laisserRetomber();

    // Le chemin de sortie n'a été emprunté que vers l'organisation émettrice.
    expect(ciblesAtteintes()).toEqual([WH_A.url]);
    expect(ciblesAtteintes()).not.toContain(WH_B.url);
  });

  it("n'emprunte pas du tout le chemin de sortie quand seule une autre organisation écoute", async () => {
    semer([WH_B]);

    await dispatchWebhookEvent(
      "document.created",
      { spaceId: ESPACE_A, documentId: "doc-1", title: "Note confidentielle de A" },
      ACTEUR.id,
      ORG_A
    );

    await laisserRetomber();

    expect(h.fetch).not.toHaveBeenCalled();
    // Rien n'est même journalisé : la ligne de B n'a jamais quitté la base.
    expect(h.insertValues).not.toHaveBeenCalled();
  });

  it("livre le webhook sans espace de sa propre organisation (chemin passant)", async () => {
    semer([WH_A]);

    await dispatchWebhookEvent(
      "document.created",
      { spaceId: ESPACE_A, documentId: "doc-1", title: "Note de A" },
      ACTEUR.id,
      ORG_A
    );

    await vi.waitFor(() => {
      expect(h.insertValues).toHaveBeenCalledTimes(1);
    });

    expect(ciblesAtteintes()).toEqual([WH_A.url]);
    const livraison = h.insertValues.mock.calls[0][0] as {
      webhookId: string;
      statusCode: number | null;
    };
    expect(livraison.webhookId).toBe("wh-a");
    expect(livraison.statusCode).toBe(200);
  });

  it("livre un webhook restreint à l'espace de l'événement (chemin passant)", async () => {
    semer([WH_A_ESPACE]);

    await dispatchWebhookEvent(
      "document.created",
      { spaceId: ESPACE_A, documentId: "doc-1", title: "Note de A" },
      ACTEUR.id,
      ORG_A
    );

    await vi.waitFor(() => {
      expect(h.fetch).toHaveBeenCalled();
    });
    await laisserRetomber();

    expect(ciblesAtteintes()).toEqual([WH_A_ESPACE.url]);
  });

  it("ne livre pas un webhook restreint à un autre espace de la même organisation", async () => {
    semer([WH_A_ESPACE]);

    await dispatchWebhookEvent(
      "document.created",
      { spaceId: AUTRE_ESPACE_A, documentId: "doc-2", title: "Note d'un autre espace" },
      ACTEUR.id,
      ORG_A
    );

    await laisserRetomber();

    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("ne livre rien quand l'organisation de l'événement est absente", async () => {
    semer([WH_A, WH_B]);

    await dispatchWebhookEvent(
      "document.created",
      { spaceId: ESPACE_A, documentId: "doc-1", title: "Note orpheline" },
      ACTEUR.id,
      null
    );

    await laisserRetomber();

    // Une organisation absente vaut « on n'émet rien », jamais « on émet à tous ».
    expect(h.fetch).not.toHaveBeenCalled();
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("ignore les webhooks historiques dépourvus d'organisation", async () => {
    semer([WH_ORPHELIN]);

    await dispatchWebhookEvent(
      "document.created",
      { spaceId: ESPACE_A, documentId: "doc-1", title: "Note de A" },
      ACTEUR.id,
      ORG_A
    );

    await laisserRetomber();

    expect(h.fetch).not.toHaveBeenCalled();
  });
});
