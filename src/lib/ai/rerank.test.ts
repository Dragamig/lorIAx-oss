import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider-resolver", () => ({
  resolveRerankProviderInOrg: vi.fn(),
  // Portee par defaut d'un appelant qui n'en passe pas : ces cas de test ne
  // portent pas sur le cloisonnement, ils exercent le reclassement lui-meme.
  instanceProviderScope: vi.fn(async () => null),
}));
vi.mock("@/lib/ai/rerank-settings", () => ({
  isRerankEnabledFor: vi.fn(),
}));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { resolveRerankProviderInOrg } from "@/lib/ai/provider-resolver";
import { isRerankEnabledFor } from "@/lib/ai/rerank-settings";
import { logAIUsage } from "@/lib/ai/usage-logger";
import {
  oversampleLimit,
  fetchLimitForRerank,
  parseRerankResponse,
  rerankCandidates,
  clearRerankCache,
} from "./rerank";

const PROVIDER = {
  apiKey: "jeton",
  baseUrl: "https://api.infomaniak.com/2/ai/1/cohere/v2",
  model: "BAAI/bge-reranker-v2-m3",
  providerId: "p1",
};

type Doc = { id: string; texte: string };
const DOCS: Doc[] = [
  { id: "a", texte: "premier" },
  { id: "b", texte: "deuxieme" },
  { id: "c", texte: "troisieme" },
];

function reponse(results: Array<{ index: number; relevance_score: number }>) {
  return {
    ok: true,
    json: async () => ({ id: "x", results, usage: { total_tokens: 42 } }),
  };
}

beforeEach(() => {
  clearRerankCache();
  vi.mocked(isRerankEnabledFor).mockResolvedValue(true);
  vi.mocked(resolveRerankProviderInOrg).mockResolvedValue(PROVIDER);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("oversampleLimit", () => {
  it("multiplie par quatre", () => {
    expect(oversampleLimit(5)).toBe(20);
  });
  it("plafonne a 40", () => {
    expect(oversampleLimit(20)).toBe(40);
  });
  it("ne descend jamais sous la limite demandee", () => {
    expect(oversampleLimit(1)).toBe(4);
  });
  it("peut descendre sous la limite demandee au-dela du plafond", () => {
    // Regression : c'est precisement ce cas que fetchLimitForRerank corrige.
    expect(oversampleLimit(60)).toBe(40);
  });
});

describe("fetchLimitForRerank", () => {
  it("sur-echantillonne normalement sous le plafond", () => {
    expect(fetchLimitForRerank(5)).toBe(20);
  });
  it("ne descend jamais sous la limite demandee, meme au-dela du plafond", () => {
    expect(fetchLimitForRerank(60)).toBe(60);
  });
  it("reste au plafond quand la limite demandee est en dessous", () => {
    expect(fetchLimitForRerank(20)).toBe(40);
  });
});

describe("parseRerankResponse", () => {
  it("lit les couples index et score", () => {
    const out = parseRerankResponse(
      { results: [{ index: 2, relevance_score: 0.9 }] },
      3
    );
    expect(out).toEqual([{ index: 2, score: 0.9 }]);
  });

  it("ecarte les index hors bornes", () => {
    const out = parseRerankResponse(
      {
        results: [
          { index: 7, relevance_score: 0.9 },
          { index: -1, relevance_score: 0.8 },
          { index: 1, relevance_score: 0.5 },
        ],
      },
      3
    );
    expect(out).toEqual([{ index: 1, score: 0.5 }]);
  });

  it("rend un tableau vide sur une forme inattendue", () => {
    expect(parseRerankResponse({ nope: true }, 3)).toEqual([]);
    expect(parseRerankResponse(null, 3)).toEqual([]);
  });

  it("deduplique les index repetes, garde la premiere occurrence", () => {
    const out = parseRerankResponse(
      {
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.5 },
          { index: 0, relevance_score: 0.2 },
        ],
      },
      2
    );
    expect(out).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.2 },
    ]);
  });

  it("ecarte les scores non finis", () => {
    const out = parseRerankResponse(
      {
        results: [
          { index: 0, relevance_score: Number.NaN },
          { index: 1, relevance_score: 0.4 },
        ],
      },
      2
    );
    expect(out).toEqual([{ index: 1, score: 0.4 }]);
  });
});

describe("rerankCandidates", () => {
  it("reordonne selon les scores et tronque", async () => {
    // Le faux repond dans le desordre (pas deja trie par score decroissant) :
    // si le tri disparaissait du module, ce test echouerait bel et bien,
    // contrairement a une reponse deja triee qui masquerait la regression.
    const fetchMock = vi.fn().mockResolvedValue(
      reponse([
        { index: 1, relevance_score: 0.1 },
        { index: 2, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
    });

    expect(out.map((d) => d.id)).toEqual(["c", "a"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resout le fournisseur dans la portee exacte recue, sans repli implicite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reponse([{ index: 0, relevance_score: 0.5 }]))
    );

    await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: "org-acme",
    });

    expect(resolveRerankProviderInOrg).toHaveBeenCalledWith("org-acme");
  });

  it("garde l'ordre d'entree quand getText leve", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const jetant = (d: Doc) => {
      if (d.id === "b") throw new Error("boom");
      return d.texte;
    };

    const out = await rerankCandidates("question", DOCS, {
      getText: jetant,
      topN: 3,
      surface: "search",
      organizationId: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("garde l'ordre d'entree quand le fournisseur repond en erreur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    const out = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
    });
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("garde l'ordre d'entree quand l'appel echoue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const out = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 3,
      surface: "search",
      organizationId: null,
    });
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("n'appelle pas le fournisseur quand la surface est eteinte", async () => {
    vi.mocked(isRerankEnabledFor).mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "chat",
      organizationId: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("n'appelle pas le fournisseur avec moins de deux candidats", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await rerankCandidates("question", [DOCS[0]], {
      getText: (d) => d.texte,
      topN: 5,
      surface: "search",
      organizationId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  it("n'appelle pas le fournisseur sur une requete trop courte", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await rerankCandidates("ab", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("n'appelle pas le fournisseur quand aucun modele n'est assigne", async () => {
    vi.mocked(resolveRerankProviderInOrg).mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("envoie l'URL, le modele et les textes tronques", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse([{ index: 0, relevance_score: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const long = { id: "l", texte: "x".repeat(5000) };

    await rerankCandidates("question", [long, DOCS[0]], {
      getText: (d) => d.texte,
      topN: 1,
      surface: "search",
      organizationId: null,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.infomaniak.com/2/ai/1/cohere/v2/rerank");
    const corps = JSON.parse(init.body as string);
    expect(corps.model).toBe("BAAI/bge-reranker-v2-m3");
    expect(corps.query).toBe("question");
    expect(corps.documents[0]).toHaveLength(2000);
    // Classement complet demande : top_n = nombre de candidats envoyes, pas
    // le topN de l'appelant (voir le commentaire sur `top_n` dans rerank.ts).
    expect(corps.top_n).toBe(2);
    expect(init.headers.Authorization).toBe("Bearer jeton");
  });

  it("complete l'ordre avec les candidats absents de la reponse, sans tronquer en silence", async () => {
    // Le fournisseur ne rend que 2 resultats pour 5 candidats envoyes (cas
    // d'une passerelle qui plafonne de son cote). Sans completion, la liste
    // rendue ferait 2 elements au lieu des 5 demandes.
    const cinq: Doc[] = [
      { id: "a", texte: "un" },
      { id: "b", texte: "deux" },
      { id: "c", texte: "trois" },
      { id: "d", texte: "quatre" },
      { id: "e", texte: "cinq" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      reponse([
        { index: 3, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await rerankCandidates("question", cinq, {
      getText: (d) => d.texte,
      topN: 5,
      surface: "search",
      organizationId: null,
    });

    // Les 2 classes en tete (par score), puis les 3 absents dans leur ordre
    // d'entree (b, c, e).
    expect(out.map((d) => d.id)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("distingue le cache de deux fournisseurs servant un modele de meme nom", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      reponse([
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.1 },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const options = {
      getText: (d: Doc) => d.texte,
      topN: 2,
      surface: "search" as const,
      organizationId: null,
    };
    await rerankCandidates("question", DOCS, options);

    vi.mocked(resolveRerankProviderInOrg).mockResolvedValue({
      ...PROVIDER,
      providerId: "p2",
      baseUrl: "https://autre-fournisseur.example/v1",
    });
    await rerankCandidates("question", DOCS, options);

    // Meme requete, meme modele, mais fournisseur different → pas de partage
    // de cache, donc un second appel HTTP.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sert le cache pour une requete identique", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      reponse([
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.2 },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const options = {
      getText: (d: Doc) => d.texte,
      topN: 2,
      surface: "search" as const,
      organizationId: null,
    };
    const un = await rerankCandidates("question", DOCS, options);
    const deux = await rerankCandidates("question", DOCS, options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deux.map((d) => d.id)).toEqual(un.map((d) => d.id));
  });

  it("ne confond pas deux requetes qui collisionnaient avec un simple join espace", async () => {
    // Sous l'ancienne cle "modele requete doc1 doc2", ces deux combinaisons
    // produisaient la meme chaine : "aaa" + ["bbb ccc", "ddd"] et
    // "aaa bbb" + ["ccc", "ddd"] donnent toutes deux "... aaa bbb ccc ddd".
    const docsA: Doc[] = [
      { id: "x1", texte: "bbb ccc" },
      { id: "x2", texte: "ddd" },
    ];
    const docsB: Doc[] = [
      { id: "y1", texte: "ccc" },
      { id: "y2", texte: "ddd" },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reponse([
          { index: 0, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.1 },
        ])
      )
      .mockResolvedValueOnce(
        reponse([
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.1 },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const outA = await rerankCandidates("aaa", docsA, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
    });
    const outB = await rerankCandidates("aaa bbb", docsB, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outA.map((d) => d.id)).toEqual(["x1", "x2"]);
    expect(outB.map((d) => d.id)).toEqual(["y2", "y1"]);
  });

  it("sert le cache meme quand le topN demande augmente ensuite", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      reponse([
        { index: 1, relevance_score: 0.1 },
        { index: 2, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const petit = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
    });
    const grand = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 3,
      surface: "search",
      organizationId: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(petit.map((d) => d.id)).toEqual(["c", "a"]);
    expect(grand.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("un echec synchrone de la journalisation ne fait pas perdre le reclassement", async () => {
    vi.mocked(logAIUsage).mockImplementation(() => {
      throw new Error("db indisponible");
    });
    const fetchMock = vi.fn().mockResolvedValue(
      reponse([
        { index: 1, relevance_score: 0.1 },
        { index: 2, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await rerankCandidates("question", DOCS, {
      getText: (d) => d.texte,
      topN: 2,
      surface: "search",
      organizationId: null,
      userId: "u1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.map((d) => d.id)).toEqual(["c", "a"]);
  });
});
