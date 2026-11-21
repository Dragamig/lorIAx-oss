/**
 * Cloisonnement des APPELANTS de la résolution de fournisseur d'IA
 * (audit AZ-06, lot 6, suite).
 *
 * `ai-provider-resolver-org-scope.test.ts` prouve que les fonctions confinées
 * respectent la portée qu'on leur donne. Il ne dit rien de ce que les appelants
 * leur donnent, et c'est précisément là que se jouait la régression : tant
 * qu'un appelant passait par une enveloppe sans organisation, il retombait sur
 * la portée instance et perdait le fournisseur de son tenant, ou pire, aurait
 * pu hériter d'un autre si l'enveloppe avait choisi arbitrairement.
 *
 * Un fichier par famille d'appelants aurait multiplié les doublures sans rien
 * prouver de plus : on exerce ici une famille à la fois, sur le MÊME moteur SQL
 * en mémoire et les MÊMES vraies fonctions de résolution.
 *
 * - contexte HTTP : `POST /api/ai/summarize`, dont la portée vient de la
 *   requête (`getRequestOrgId`) ;
 * - chemin différé : le traitement d'une note vocale, dont la portée se dérive
 *   de l'objet traité (note → document → espace → organisation) ;
 * - tâche d'instance : la résolution du modèle d'embedding, dont la portée est
 *   celle de l'instance, par nature.
 *
 * L'observable est le `modelId` du modèle de langage remis à l'appelant. Chaque
 * fournisseur du jeu de données porte un modèle par défaut distinct
 * (`modele-acme`, `modele-victime`, `modele-instance`) : lire ce champ dit sans
 * ambiguïté quel fournisseur a été sélectionné.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requetes: [] as { sql: string; params: unknown[] }[],
  orgDeLaRequete: null as string | null,
  modeles: [] as unknown[],
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

// Contexte HTTP : la session et le contrôle d'accès ne sont pas le sujet ici,
// seule la portée d'organisation l'est.
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "user-1",
    name: "Utilisateur",
    email: "u@exemple.test",
    globalRole: "user",
  })),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(async () => true),
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(async () => h.orgDeLaRequete),
}));

vi.mock("@/lib/storage/filesystem", () => ({
  readDocument: vi.fn(async () => "Contenu du document"),
}));

// Le modèle remis à `generateText` est l'observable de tous les tests.
vi.mock("ai", () => ({
  generateText: vi.fn(async (params: { model: unknown }) => {
    h.modeles.push(params.model);
    return {
      text: "Résumé",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    };
  }),
}));

// Journalisation d'usage et prompts : hors sujet, et ils liraient des tables
// que le moteur en mémoire ne connaît pas.
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/ai/prompt-resolver", () => ({
  resolvePrompt: vi.fn(async () => null),
  interpolatePrompt: (gabarit: string) => gabarit,
  getSystemPrompt: vi.fn(async () => ({ prompt: "sys", versionId: undefined })),
}));
vi.mock("@/lib/voice-notes/store", () => ({
  updateVoiceNote: vi.fn(async () => ({})),
}));

import { runVoiceNoteProcessJob } from "@/lib/voice-notes/process";
import { orgIdForAutomation, orgIdForSpace } from "@/lib/ai/org-scope";
import { resolveActiveEmbeddingModel } from "@/lib/ai/embedding-dimensions";
import {
  assigner,
  donnees,
  reinitialiser,
  FOURNISSEUR_INSTANCE,
  FOURNISSEUR_VICTIME,
  NOTE_ACME,
  NOTE_VICTIME,
  DOCUMENT_ACME,
  DOCUMENT_VICTIME,
  ORG_ACME,
  ORG_VICTIME,
  FOURNISSEUR_ACME,
} from "./ai-provider-resolver-moteur-sql";

/** `modelId` du dernier modèle remis à `generateText`. */
function dernierModele(): string {
  const modele = h.modeles.at(-1) as { modelId?: string } | undefined;
  return modele?.modelId ?? "(aucun modèle)";
}

/** Tous les paramètres soumis au moteur, toutes requêtes confondues. */
function tousLesParams(): unknown[] {
  return h.requetes.flatMap((r) => r.params);
}

beforeEach(() => {
  h.requetes.length = 0;
  h.modeles.length = 0;
  h.orgDeLaRequete = null;
  reinitialiser();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Famille 1 : contexte HTTP
// ---------------------------------------------------------------------------

async function resumer(documentId: string) {
  const { POST } = await import("@/app/api/ai/summarize/route");
  return POST(
    new NextRequest("http://localhost/api/ai/summarize", {
      method: "POST",
      body: JSON.stringify({ documentId }),
      headers: { "content-type": "application/json" },
    })
  );
}

describe("contexte HTTP : la portée vient de la requête", () => {
  it("résume avec le fournisseur de l'organisation de la requête", async () => {
    h.orgDeLaRequete = ORG_ACME;

    const res = await resumer(DOCUMENT_ACME);

    expect(res.status).toBe(200);
    expect(dernierModele()).toBe("modele-acme");
  });

  it("rend à chaque tenant le sien, sur le même jeu de données", async () => {
    h.orgDeLaRequete = ORG_VICTIME;
    await resumer(DOCUMENT_VICTIME);

    expect(dernierModele()).toBe("modele-victime");
  });

  it("n'interroge jamais la base au nom d'une organisation voisine", async () => {
    h.orgDeLaRequete = ORG_ACME;
    await resumer(DOCUMENT_ACME);

    expect(tousLesParams()).toContain(ORG_ACME);
    expect(tousLesParams()).not.toContain(ORG_VICTIME);
  });

  it("une assignation désignant le fournisseur d'un autre tenant ne le rend pas accessible", async () => {
    // L'assignation de modèle est de portée instance : elle peut parfaitement
    // pointer le fournisseur d'un tenant. Ce n'est pas une autorisation.
    assigner({
      usageType: "summary_doc",
      providerId: FOURNISSEUR_VICTIME,
      model: "modele-vole",
    });
    h.orgDeLaRequete = ORG_ACME;

    await resumer(DOCUMENT_ACME);

    expect(dernierModele()).not.toBe("modele-vole");
    expect(dernierModele()).toBe("modele-acme");
  });

  it("sans organisation résolue, se limite à la portée instance (fail-closed)", async () => {
    // `getRequestOrgId` rend `null` quand l'organisation est introuvable ou
    // l'accès refusé : cela ne doit jamais valoir « toutes les organisations ».
    h.orgDeLaRequete = null;

    await resumer(DOCUMENT_ACME);

    expect(dernierModele()).toBe("modele-instance");
  });
});

// ---------------------------------------------------------------------------
// Famille 2 : chemin différé, portée dérivée de l'objet traité
// ---------------------------------------------------------------------------

describe("chemin différé : la portée se dérive de l'objet traité", () => {
  it("traite une note vocale avec le fournisseur de l'organisation de son espace", async () => {
    await runVoiceNoteProcessJob({
      noteId: NOTE_ACME,
      kind: "summary",
      transcript: "Rappeler le fournisseur avant vendredi.",
      userId: "user-1",
    });

    expect(dernierModele()).toBe("modele-acme");
  });

  it("rend à la note d'un autre tenant le fournisseur de ce tenant, jamais l'inverse", async () => {
    await runVoiceNoteProcessJob({
      noteId: NOTE_VICTIME,
      kind: "summary",
      transcript: "Rappeler le fournisseur avant vendredi.",
      userId: "user-1",
    });

    expect(dernierModele()).toBe("modele-victime");
    expect(dernierModele()).not.toBe("modele-acme");
  });

  it("note introuvable : portée instance seule, jamais un tenant au hasard", async () => {
    donnees.voice_notes = [];

    await runVoiceNoteProcessJob({
      noteId: NOTE_ACME,
      kind: "summary",
      transcript: "Rappeler le fournisseur avant vendredi.",
      userId: "user-1",
    });

    expect(dernierModele()).toBe("modele-instance");
  });
});

// ---------------------------------------------------------------------------
// Famille 3 : tâche d'instance
// ---------------------------------------------------------------------------

describe("tâche d'instance : portée instance assumée, sans emprunt", () => {
  it("n'adopte pas le modèle d'embedding d'un tenant sur une instance multi-organisations", async () => {
    assigner({
      usageType: "embeddings",
      providerId: FOURNISSEUR_VICTIME,
      model: "embed-vole",
    });

    // Deux organisations actives : la portée instance ne désigne aucun tenant,
    // le fournisseur de Victime est donc hors d'atteinte et l'on retombe sur
    // l'environnement.
    expect(await resolveActiveEmbeddingModel()).not.toBe("embed-vole");
  });

  it("adopte le modèle d'un fournisseur de portée instance", async () => {
    assigner({
      usageType: "embeddings",
      providerId: FOURNISSEUR_INSTANCE,
      model: "embed-instance",
    });

    expect(await resolveActiveEmbeddingModel()).toBe("embed-instance");
  });

  it("sur une instance mono-organisation, garde accessible le fournisseur de ce tenant", async () => {
    // Cas majoritaire de l'auto-hébergement : la migration 0014 a rattaché les
    // fournisseurs préexistants à l'unique organisation, la ré-indexation doit
    // continuer de les voir.
    donnees.organizations = [
      { id: ORG_VICTIME, slug: "victime", name: "Victime", isActive: true },
    ];
    assigner({
      usageType: "embeddings",
      providerId: FOURNISSEUR_VICTIME,
      model: "embed-maison",
    });

    expect(await resolveActiveEmbeddingModel()).toBe("embed-maison");
  });
});

// ---------------------------------------------------------------------------
// Famille 4 : « je n'ai pas su dériver d'organisation », une seule réponse
// ---------------------------------------------------------------------------

/**
 * Incohérence corrigée le 2026-08-20. `@/lib/ai/org-scope` rendait un `null`
 * sec quand l'organisation était indérivable, là où `rerank.ts` et les chemins
 * d'embeddings passaient déjà par `instanceProviderScope`. Le même `null`
 * valait donc « l'organisation unique de l'instance » d'un côté et « rien » de
 * l'autre.
 *
 * La propriété qui compte tient en deux phrases, et c'est ce que ces tests
 * mesurent : sur une instance à UNE seule organisation, cas majoritaire du
 * produit, un chemin différé sans organisation dérivable obtient bien le
 * fournisseur configuré ; sur une instance à PLUSIEURS organisations, il
 * n'obtient jamais celui d'un tenant.
 */
describe("portée indérivable : le repli est unique, et il ne prête à personne", () => {
  /** Ne laisse qu'une organisation active, et son seul fournisseur. */
  function instanceMonoOrganisation() {
    donnees.organizations = [
      { id: ORG_VICTIME, slug: "victime", name: "Victime", isActive: true },
    ];
    // La migration 0014 a rattaché TOUS les fournisseurs préexistants à
    // l'organisation par défaut : sur une instance auto-hébergée, il ne reste
    // aucun fournisseur de portée instance. On reproduit exactement cet état,
    // sans quoi le repli fautif serait masqué par `modele-instance`.
    donnees.ai_providers = donnees.ai_providers.filter(
      (p) => p.organizationId === ORG_VICTIME
    );
  }

  it("automatisation sans espace ni base : sur une instance mono-organisation, c'est cette organisation", async () => {
    // Les deux colonnes de rattachement sont nullables et aucune contrainte
    // `check` ne les lie : la ligne « ni espace ni base » est représentable.
    instanceMonoOrganisation();

    expect(await orgIdForAutomation({ spaceId: null, databaseId: null })).toBe(
      ORG_VICTIME
    );
  });

  it("la même automatisation, sur une instance multi-organisations, ne désigne aucun tenant", async () => {
    expect(await orgIdForAutomation({ spaceId: null, databaseId: null })).toBeNull();
  });

  it("réunion sans espace : même repli, même réponse", async () => {
    instanceMonoOrganisation();

    expect(await orgIdForSpace(null)).toBe(ORG_VICTIME);
    expect(await orgIdForSpace("space-inexistant")).toBe(ORG_VICTIME);
  });

  it("chemin différé indérivable : l'instance mono-organisation garde son fournisseur, sans retomber sur l'environnement", async () => {
    instanceMonoOrganisation();
    donnees.voice_notes = [];

    await runVoiceNoteProcessJob({
      noteId: NOTE_ACME,
      kind: "summary",
      transcript: "Rappeler le fournisseur avant vendredi.",
      userId: "user-1",
    });

    // Sans l'unification, la portée valait `null`, aucun fournisseur n'était
    // sélectionnable et la résolution retombait SILENCIEUSEMENT sur les
    // variables d'environnement : la configuration d'IA de l'instance était
    // perdue pour ce chemin.
    expect(dernierModele()).toBe("modele-victime");
  });

  it("chemin différé indérivable : l'instance multi-organisations n'emprunte le fournisseur d'aucun tenant", async () => {
    donnees.voice_notes = [];

    await runVoiceNoteProcessJob({
      noteId: NOTE_ACME,
      kind: "summary",
      transcript: "Rappeler le fournisseur avant vendredi.",
      userId: "user-1",
    });

    expect(dernierModele()).not.toBe("modele-acme");
    expect(dernierModele()).not.toBe("modele-victime");
    expect(tousLesParams()).not.toContain(FOURNISSEUR_ACME);
  });
});
