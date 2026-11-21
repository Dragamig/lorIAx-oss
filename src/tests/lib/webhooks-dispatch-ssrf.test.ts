/**
 * Non-régression INJ-07 (audit du 2026-08-19).
 *
 * `deliverWebhook` (atteint via l'export `dispatchWebhookEvent` de
 * `src/lib/webhooks/dispatch.ts`) émettait la requête avec un `fetch` nu, sans
 * revalider l'URL au moment de l'émission. Une URL interne posée en base
 * (avant le correctif du schéma d'écriture, ou par une résolution DNS qui
 * change entre l'écriture et l'appel) déclenchait alors un SSRF aveugle.
 *
 * Motif de vérification : le module passe désormais par `safeExternalFetch`
 * (non mocké ici, pour vérifier le comportement réel de bout en bout) ; seul
 * le `fetch` global qu'il utilise en interne est mocké. L'absence d'effet de
 * bord se prouve sur ce `fetch`, qui ne doit jamais partir, et sur
 * l'enregistrement de la livraison, qui doit être journalisée en échec.
 *
 * Les deux tests d'origine ne couvraient qu'une adresse interne littérale, et
 * aucun ne prouvait qu'un webhook légitime part encore : si le suivi des
 * redirections de `safeExternalFetch` cassait toutes les livraisons
 * sortantes, cette suite resterait verte. Un test nominal (cible publique) et
 * un test de résolution DNS (nom public qui résout vers l'intérieur, `dns`
 * mocké pour rester déterministe hors réseau) complètent la couverture.
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

/** Chaîne `select().from().where()...`, thenable quelle que soit sa longueur. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

const ORG = "11111111-1111-4111-8111-111111111111";
const ACTOR = { id: "user-1", email: "u@exemple.tld", name: "Utilisatrice" };
const WEBHOOK_INTERNE = {
  id: "wh-1",
  url: "http://169.254.169.254/latest/meta-data/",
  secret: "secret-du-webhook",
  events: ["document.created"],
  spaceId: null,
  organizationId: ORG,
  failureCount: 0,
};

/** Cible publique légitime : IPv4 littérale (TEST-NET-3, RFC 5737), aucune résolution DNS requise. */
const WEBHOOK_PUBLIC = {
  id: "wh-2",
  url: "https://203.0.113.10/webhook",
  secret: "secret-du-webhook",
  events: ["document.created"],
  spaceId: null,
  organizationId: ORG,
  failureCount: 0,
};

/** Nom public qui résout vers le réseau interne au moment de l'appel (INJ-07). */
const WEBHOOK_REBINDING = {
  id: "wh-3",
  url: "https://interne.attaquant-legit.tld/webhook",
  secret: "secret-du-webhook",
  events: ["document.created"],
  spaceId: null,
  organizationId: ORG,
  failureCount: 0,
};

/** Webhook auto-hébergé visant un service interne (n8n), cas de l'exception. */
const WEBHOOK_INTERNE_LEGITIME = {
  id: "wh-4",
  url: "http://n8n:5678/webhook/abc",
  secret: "secret-du-webhook",
  events: ["document.created"],
  spaceId: null,
  organizationId: ORG,
  failureCount: 0,
};

/** Protocole non http(s) : toujours refusé, même exception activée. */
const WEBHOOK_PROTOCOLE_INTERDIT = {
  id: "wh-5",
  url: "file:///etc/passwd",
  secret: "secret-du-webhook",
  events: ["document.created"],
  spaceId: null,
  organizationId: ORG,
  failureCount: 0,
};

vi.mock("@/lib/db", () => ({
  db: {
    // 1er appel : recherche de l'auteur de l'événement.
    // 2e appel : recherche des webhooks actifs correspondants.
    select: vi.fn(),
    update: vi.fn(() => ({ set: h.updateSet })),
    insert: vi.fn(() => ({ values: h.insertValues })),
  },
}));

import { db } from "@/lib/db";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";

/**
 * Chaque test choisit le webhook livré ; l'auteur de l'événement est fixe.
 * `mockReset` (et non `clearAllMocks`, insuffisant) vide la file de
 * `mockReturnValueOnce` : sans lui, une valeur mise en file par un test et
 * jamais consommée (livraison encore en vol à la fin du test précédent)
 * fuitait vers le test suivant et lui faisait lire le mauvais webhook.
 */
function queueWebhook(webhook: unknown) {
  vi.mocked(db.select).mockReset();
  vi.mocked(db.select)
    .mockReturnValueOnce(selectChain([ACTOR]) as never)
    .mockReturnValueOnce(selectChain([webhook]) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue(new Response(null, { status: 200 }));
  h.updateSet.mockReturnValue({ where: h.updateWhere });
  h.updateWhere.mockResolvedValue(undefined);
  h.insertValues.mockResolvedValue(undefined);
  // Résolution DNS par défaut : une IP publique, pour les tests qui ne
  // portent pas sur le rebinding et n'utilisent pas d'adresse IP littérale.
  h.dnsLookup.mockResolvedValue([{ address: "203.0.113.20", family: 4 }]);
  queueWebhook(WEBHOOK_INTERNE);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("dispatchWebhookEvent", () => {
  it("n'émet aucune requête vers un webhook pointant sur le réseau interne", async () => {
    await dispatchWebhookEvent("document.created", { spaceId: undefined }, "user-1", ORG);

    await vi.waitFor(() => {
      expect(h.insertValues).toHaveBeenCalledTimes(1);
    });

    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("journalise la livraison comme un échec et incrémente le compteur d'échecs", async () => {
    await dispatchWebhookEvent("document.created", { spaceId: undefined }, "user-1", ORG);

    await vi.waitFor(() => {
      expect(h.insertValues).toHaveBeenCalledTimes(1);
    });

    const delivery = h.insertValues.mock.calls[0][0] as {
      webhookId: string;
      statusCode: number | null;
      attempts: number;
    };
    expect(delivery.webhookId).toBe("wh-1");
    expect(delivery.statusCode).toBeNull();
    expect(delivery.attempts).toBe(1);

    expect(h.updateSet).toHaveBeenCalledTimes(1);
    const update = h.updateSet.mock.calls[0][0] as { failureCount: number };
    expect(update.failureCount).toBe(1);
  });

  it("émet bien la requête et journalise le succès pour une cible publique légitime", async () => {
    queueWebhook(WEBHOOK_PUBLIC);
    h.fetch.mockResolvedValue(new Response("ok", { status: 200 }));

    await dispatchWebhookEvent("document.created", { spaceId: undefined }, "user-1", ORG);

    await vi.waitFor(() => {
      expect(h.insertValues).toHaveBeenCalledTimes(1);
    });

    // La requête part une seule fois, vers la cible déclarée du webhook.
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [target] = h.fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe(WEBHOOK_PUBLIC.url);

    const delivery = h.insertValues.mock.calls[0][0] as {
      webhookId: string;
      statusCode: number | null;
      attempts: number;
    };
    expect(delivery.webhookId).toBe("wh-2");
    expect(delivery.statusCode).toBe(200);

    // Succès : le compteur d'échecs est remis à zéro, pas incrémenté.
    expect(h.updateSet).toHaveBeenCalledTimes(1);
    const update = h.updateSet.mock.calls[0][0] as { failureCount: number };
    expect(update.failureCount).toBe(0);
  });

  it("n'émet aucune requête quand un nom public résout vers le réseau interne (rebinding)", async () => {
    queueWebhook(WEBHOOK_REBINDING);
    // Le nom se résout vers une adresse de métadonnées cloud au moment de l'appel.
    h.dnsLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    await dispatchWebhookEvent("document.created", { spaceId: undefined }, "user-1", ORG);

    await vi.waitFor(() => {
      expect(h.insertValues).toHaveBeenCalledTimes(1);
    });

    expect(h.fetch).not.toHaveBeenCalled();

    const delivery = h.insertValues.mock.calls[0][0] as {
      webhookId: string;
      statusCode: number | null;
    };
    expect(delivery.webhookId).toBe("wh-3");
    expect(delivery.statusCode).toBeNull();
  });

  // Non-régression : exception `WEBHOOK_ALLOW_PRIVATE_TARGETS` (décision du
  // 20/08/2026). Sans la variable, une cible interne reste refusée comme
  // aujourd'hui : ce cas est déjà couvert plus haut par WEBHOOK_INTERNE, qui
  // ne pose jamais la variable.
  it("émet la requête vers une cible interne quand WEBHOOK_ALLOW_PRIVATE_TARGETS=true", async () => {
    vi.stubEnv("WEBHOOK_ALLOW_PRIVATE_TARGETS", "true");
    queueWebhook(WEBHOOK_INTERNE_LEGITIME);
    h.fetch.mockResolvedValue(new Response("ok", { status: 200 }));

    await dispatchWebhookEvent("document.created", { spaceId: undefined }, "user-1", ORG);

    await vi.waitFor(() => {
      expect(h.insertValues).toHaveBeenCalledTimes(1);
    });

    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [target] = h.fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe(WEBHOOK_INTERNE_LEGITIME.url);

    const delivery = h.insertValues.mock.calls[0][0] as { statusCode: number | null };
    expect(delivery.statusCode).toBe(200);
  });

  it("refuse toujours un protocole non http/https même avec WEBHOOK_ALLOW_PRIVATE_TARGETS=true", async () => {
    vi.stubEnv("WEBHOOK_ALLOW_PRIVATE_TARGETS", "true");
    queueWebhook(WEBHOOK_PROTOCOLE_INTERDIT);

    await dispatchWebhookEvent("document.created", { spaceId: undefined }, "user-1", ORG);

    await vi.waitFor(() => {
      expect(h.insertValues).toHaveBeenCalledTimes(1);
    });

    expect(h.fetch).not.toHaveBeenCalled();
    const delivery = h.insertValues.mock.calls[0][0] as { statusCode: number | null };
    expect(delivery.statusCode).toBeNull();
  });

  // Le module combine minuteurs simulés et délai d'abandon (`AbortSignal.timeout`
  // dans `safeExternalFetch`) ; on rejoue le scénario plusieurs fois pour
  // écarter une dépendance à l'ordre ou une instabilité entre exécutions.
  it.for([1, 2, 3])(
    "reste stable sur des exécutions répétées (essai %i)",
    async () => {
      queueWebhook(WEBHOOK_PUBLIC);

      await dispatchWebhookEvent("document.created", { spaceId: undefined }, "user-1", ORG);

      await vi.waitFor(() => {
        expect(h.insertValues).toHaveBeenCalledTimes(1);
      });

      expect(h.fetch).toHaveBeenCalledTimes(1);
      const delivery = h.insertValues.mock.calls[0][0] as { statusCode: number | null };
      expect(delivery.statusCode).toBe(200);
    }
  );
});
