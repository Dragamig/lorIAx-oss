/**
 * Cloisonnement de la sélection du fournisseur d'IA (constat AZ-06, lot 6).
 *
 * Avant le lot, `provider-resolver.ts` chargeait les fournisseurs sans aucune
 * clause d'organisation : par identifiant nu depuis `ai_model_assignments`, et
 * surtout, dans le repli historique, en prenant le PREMIER fournisseur portant
 * `is_default`, toutes organisations confondues. Le fournisseur d'un tenant
 * pouvait donc servir les requêtes d'un autre : sa clé d'API consommée, et les
 * données du second acheminées vers un point de terminaison contrôlé par le
 * premier. La voie d'écriture a été fermée par `scope.ts`, la sélection
 * restait aveugle.
 *
 * Ce fichier exerce la VRAIE fonction. Le faux client est un `drizzle` monté
 * sur `pg-proxy` : la requête est réellement compilée en SQL, puis exécutée par
 * un petit moteur relationnel en mémoire. On peut donc à la fois inspecter les
 * conditions soumises et constater ce qui est effectivement rendu.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  requetes: [] as { sql: string; params: unknown[] }[],
}));

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const schema = await import("@/lib/db/schema");
  const { executerSql } = await import("./ai-provider-resolver-moteur-sql");
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
  resolveProviderForUsageInOrg,
  resolveEmbeddingProviderInOrg,
  resolveRerankProviderInOrg,
  instanceProviderScope,
} from "@/lib/ai/provider-resolver";
import {
  assigner,
  donnees,
  reinitialiser,
  FOURNISSEUR_ACME,
  FOURNISSEUR_INSTANCE,
  FOURNISSEUR_VICTIME,
  ORG_ACME,
  ORG_TIERS,
  ORG_VICTIME,
} from "./ai-provider-resolver-moteur-sql";

/** SQL de toutes les requêtes soumises, espaces normalisés. */
function toutLeSql(): string {
  return h.requetes.map((r) => r.sql.replace(/\s+/g, " ")).join("\n");
}

/** Tous les paramètres soumis, toutes requêtes confondues. */
function tousLesParams(): unknown[] {
  return h.requetes.flatMap((r) => r.params);
}

beforeEach(() => {
  h.requetes.length = 0;
  reinitialiser();
});

describe("repli historique : le fournisseur « par défaut » est borné à l'organisation", () => {
  it("rend le fournisseur de l'organisation courante, jamais celui d'un autre tenant", async () => {
    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    expect(resolu.providerId).toBe(FOURNISSEUR_ACME);
    expect(resolu.providerId).not.toBe(FOURNISSEUR_VICTIME);
    expect(resolu.model).toBe("modele-acme");
  });

  it("rend à chaque tenant le sien, sur le même jeu de données", async () => {
    const acme = await resolveProviderForUsageInOrg("chat", ORG_ACME);
    const victime = await resolveProviderForUsageInOrg("chat", ORG_VICTIME);

    expect(acme.providerId).toBe(FOURNISSEUR_ACME);
    expect(victime.providerId).toBe(FOURNISSEUR_VICTIME);
  });

  it("soumet bien une condition d'organisation, et non une sélection globale", async () => {
    await resolveProviderForUsageInOrg("chat", ORG_ACME);

    const sql = toutLeSql();
    expect(sql).toContain('"ai_providers"."organization_id" =');
    expect(sql).toContain('"ai_providers"."organization_id" is null');
    expect(tousLesParams()).toContain(ORG_ACME);
    // Aucune requête ne mentionne l'organisation voisine.
    expect(tousLesParams()).not.toContain(ORG_VICTIME);
  });

  it("se rabat sur le fournisseur de portée instance quand l'organisation n'a pas de défaut", async () => {
    // Le tenant n'a aucun fournisseur : seul celui d'instance reste.
    const resolu = await resolveProviderForUsageInOrg("chat", ORG_TIERS);

    expect(resolu.providerId).toBe(FOURNISSEUR_INSTANCE);
    expect(resolu.model).toBe("modele-instance");
  });

  it("préfère le fournisseur de l'organisation à celui de portée instance", async () => {
    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    expect(resolu.providerId).toBe(FOURNISSEUR_ACME);
    expect(resolu.providerId).not.toBe(FOURNISSEUR_INSTANCE);
  });
});

describe("assignation de modèle : un identifiant nu ne suffit plus", () => {
  it("ignore une assignation qui désigne le fournisseur d'un autre tenant", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_VICTIME, model: "modele-vole" });

    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    // Ni le fournisseur ni le modèle du voisin : on retombe sur le repli, borné.
    expect(resolu.providerId).not.toBe(FOURNISSEUR_VICTIME);
    expect(resolu.model).not.toBe("modele-vole");
    expect(resolu.providerId).toBe(FOURNISSEUR_ACME);
  });

  it("ignore aussi un fournisseur de repli d'assignation appartenant à un autre tenant", async () => {
    assigner({
      usageType: "chat",
      // Primaire inconnu de la portée : force le passage par le repli d'assignation.
      providerId: "prov-inexistant",
      model: "modele-primaire",
      fallbackProviderId: FOURNISSEUR_VICTIME,
      fallbackModel: "modele-vole",
    });

    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    expect(resolu.providerId).toBe(FOURNISSEUR_ACME);
    expect(resolu.isFallback).toBe(false);
  });

  it("sélectionne le fournisseur de l'organisation quand l'assignation le désigne", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_ACME, model: "modele-assigne" });

    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    expect(resolu.providerId).toBe(FOURNISSEUR_ACME);
    expect(resolu.model).toBe("modele-assigne");
  });

  it("garde sélectionnable un fournisseur de portée instance (auto-hébergement)", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_INSTANCE, model: "modele-assigne" });

    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    expect(resolu.providerId).toBe(FOURNISSEUR_INSTANCE);
    expect(resolu.model).toBe("modele-assigne");
  });
});

describe("aucun fournisseur disponible : le comportement d'avant est conservé", () => {
  beforeEach(() => {
    donnees.ai_providers = [];
  });

  it("retombe sur les variables d'environnement", async () => {
    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    expect(resolu.providerId).toBeNull();
    expect(resolu.providerName).toBe(process.env.DEFAULT_AI_PROVIDER || "ollama");
    expect(resolu.isFallback).toBe(false);
    expect(resolu.connectorType).toBe("openai_compatible");
  });

  it("retombe aussi sur l'environnement quand l'assignation désigne un fournisseur absent", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_VICTIME, model: "modele-vole" });

    const resolu = await resolveProviderForUsageInOrg("chat", ORG_ACME);

    expect(resolu.providerId).toBeNull();
    expect(resolu.model).toBe(process.env.DEFAULT_AI_MODEL || "gemma4:e4b");
  });
});

describe("embeddings et reclassement : même cloisonnement", () => {
  it("n'emprunte pas le fournisseur d'embeddings d'un autre tenant", async () => {
    assigner({ usageType: "embeddings", providerId: FOURNISSEUR_VICTIME, model: "embed-vole" });

    expect(await resolveEmbeddingProviderInOrg(ORG_ACME)).toBeNull();
    // Le tenant propriétaire, lui, y a bien droit.
    expect((await resolveEmbeddingProviderInOrg(ORG_VICTIME))?.providerId).toBe(
      FOURNISSEUR_VICTIME
    );
  });

  it("garde utilisable un fournisseur d'embeddings de portée instance", async () => {
    assigner({ usageType: "embeddings", providerId: FOURNISSEUR_INSTANCE, model: "embed" });

    const resolu = await resolveEmbeddingProviderInOrg(ORG_ACME);

    expect(resolu?.providerId).toBe(FOURNISSEUR_INSTANCE);
    expect(resolu?.kind).toBe("openai");
  });

  it("n'emprunte pas le fournisseur de reclassement d'un autre tenant", async () => {
    assigner({ usageType: "rerank", providerId: FOURNISSEUR_VICTIME, model: "rerank-vole" });

    expect(await resolveRerankProviderInOrg(ORG_ACME)).toBeNull();
    expect((await resolveRerankProviderInOrg(ORG_VICTIME))?.providerId).toBe(
      FOURNISSEUR_VICTIME
    );
  });
});

describe("portée d'instance : le seul cas où aucune organisation n'est passée", () => {
  it("sur une instance mono-organisation, rend cette organisation", async () => {
    donnees.organizations = [{ id: ORG_ACME, slug: "acme", name: "Acme", isActive: true }];

    expect(await instanceProviderScope()).toBe(ORG_ACME);
  });

  it("sur une instance multi-organisations, ne choisit aucun tenant", async () => {
    // Deux organisations actives : aucun choix arbitraire n'est licite.
    expect(await instanceProviderScope()).toBeNull();
  });

  it("la portée rendue ne donne accès qu'au fournisseur d'instance", async () => {
    const resolu = await resolveProviderForUsageInOrg(
      "chat",
      await instanceProviderScope()
    );

    expect(resolu.providerId).toBe(FOURNISSEUR_INSTANCE);
    expect(resolu.providerId).not.toBe(FOURNISSEUR_ACME);
    expect(resolu.providerId).not.toBe(FOURNISSEUR_VICTIME);
  });
});
