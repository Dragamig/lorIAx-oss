/**
 * Lib serveur des modèles de présentation (`src/lib/presentations/templates.ts`,
 * lot 3bis, T4) : semis, liste, duplication, copie et réinitialisation.
 *
 * La base est une table en mémoire dont les opérateurs drizzle (`eq`, `and`,
 * `isNull`) sont évalués pour de vrai : une clause retirée d'une requête change
 * donc le résultat, ce qu'un simple stub de chaîne ne verrait pas. Les
 * assertions portent sur les effets de bord (`uploadFile`, `getFileJson`,
 * `deleteFile`, lignes en base), pas seulement sur les valeurs rendues.
 *
 * Mutation vérifiée : retirer `eq(presentations.organizationId, orgId)` de
 * `listTemplates` fait échouer « la liste d'une organisation ne contient aucun
 * modèle d'une autre ».
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  uploadFile: vi.fn(),
  getFileJson: vi.fn(),
  deleteFile: vi.fn(),
  nextId: 0,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name: string }, val: unknown) => ({ col: col.name, op: "eq", val }),
    isNull: (col: { name: string }) => ({ col: col.name, op: "null" }),
    and: (...parts: unknown[]) => ({ op: "and", parts }),
    desc: (col: { name: string }) => ({ col: col.name, op: "desc" }),
  };
});

vi.mock("@/lib/db", async () => {
  const { presentations } = await import("@/lib/db/schema-presentations");
  const camel = (snake: string) =>
    Object.keys(presentations).find(
      (k) => (presentations as unknown as Record<string, { name?: string }>)[k]?.name === snake
    ) as string;
  type Pred = { op: string; col?: string; val?: unknown; parts?: Pred[] };
  const test = (p: Pred, r: Record<string, unknown>): boolean => {
    if (p.op === "and") return p.parts!.every((x) => test(x, r));
    if (p.op === "eq") return r[camel(p.col!)] === p.val;
    if (p.op === "null") return r[camel(p.col!)] == null;
    return true;
  };
  const chain = (get: () => unknown[]) => {
    let pred: Pred | undefined;
    const run = () => get().filter((r) => !pred || test(pred, r as Record<string, unknown>));
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: (p: Pred) => ((pred = p), obj),
      orderBy: () => Promise.resolve(run()),
      limit: () => Promise.resolve(run()),
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    };
    return obj;
  };
  return {
    db: {
      select: () => chain(() => h.rows),
      insert: () => {
        let values: Record<string, unknown>[] = [];
        let skip = false;
        const apply = () => {
          const inserted: Record<string, unknown>[] = [];
          for (const v of values) {
            const dup =
              v.templateSeedKey != null &&
              h.rows.some(
                (r) =>
                  r.organizationId === v.organizationId && r.templateSeedKey === v.templateSeedKey
              );
            if (dup && skip) continue;
            const row = {
              id: `00000000-0000-4000-8000-${String(++h.nextId).padStart(12, "0")}`,
              spaceId: null,
              organizationId: null,
              isTemplate: false,
              templateDescription: null,
              templateOrigin: null,
              templateSeedKey: null,
              templateHiddenAt: null,
              documentId: null,
              version: 1,
              slideCount: 0,
              thumbnailKey: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...v,
            };
            h.rows.push(row);
            inserted.push(row);
          }
          return inserted;
        };
        const obj: Record<string, unknown> = {
          values: (v: Record<string, unknown> | Record<string, unknown>[]) => (
            (values = Array.isArray(v) ? v : [v]), obj
          ),
          onConflictDoNothing: () => ((skip = true), obj),
          returning: () => Promise.resolve(apply()),
        };
        return obj;
      },
      update: () => {
        let patch: Record<string, unknown> = {};
        let pred: Pred | undefined;
        const obj: Record<string, unknown> = {
          set: (s: Record<string, unknown>) => ((patch = s), obj),
          where: (p: Pred) => ((pred = p), obj),
          returning: () => {
            const hit = h.rows.filter((r) => !pred || test(pred, r));
            hit.forEach((r) => Object.assign(r, patch));
            return Promise.resolve(hit);
          },
          then: (res: (v: unknown) => unknown) =>
            (obj.returning as () => Promise<unknown>)().then(res),
        };
        return obj;
      },
    },
  };
});

vi.mock("@/lib/storage/s3", () => ({
  uploadFile: h.uploadFile,
  getFileJson: h.getFileJson,
  deleteFile: h.deleteFile,
}));

import {
  ensureSeededTemplates,
  listTemplates,
  cloneTemplatePayload,
  copyPresentationAsTemplate,
  SourceDeckMissingError,
  resetTemplate,
} from "@/lib/presentations/templates";
import { LORIAX_TEMPLATES, getLorIAxTemplate } from "@/lib/presentations/templates/index";
import { createEmptyDeck } from "@/lib/presentations/deck";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const keysUploaded = () => h.uploadFile.mock.calls.map((c) => c[0] as string);
const uploaded = (i: number) => JSON.parse((h.uploadFile.mock.calls[i][1] as Buffer).toString());

beforeEach(() => {
  h.rows.length = 0;
  h.nextId = 0;
  h.uploadFile.mockReset().mockResolvedValue(undefined);
  h.getFileJson.mockReset().mockResolvedValue(null);
  h.deleteFile.mockReset();
});

describe("ensureSeededTemplates", () => {
  it("semer deux fois laisse 4 lignes et 4 objets S3", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    await ensureSeededTemplates(ORG_A, USER);
    expect(h.rows).toHaveLength(4);
    expect(h.uploadFile).toHaveBeenCalledTimes(4);
    expect(h.rows.every((r) => r.templateOrigin === "lorIAx" && r.isTemplate && r.spaceId === null)).toBe(true);
    expect(h.rows.every((r) => r.createdBy === USER && r.organizationId === ORG_A)).toBe(true);
  });

  it("deux semis concurrents donnent 4 lignes", async () => {
    await Promise.all([ensureSeededTemplates(ORG_A, USER), ensureSeededTemplates(ORG_A, USER)]);
    expect(h.rows).toHaveLength(4);
    expect(h.uploadFile).toHaveBeenCalledTimes(4);
  });

  it("chaque copie porte un docId neuf et une date de modification courante", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    const docIds = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const deck = uploaded(i);
      expect(typeof deck.docId).toBe("string");
      docIds.add(deck.docId);
      expect(Date.now() - new Date(deck.modified).getTime()).toBeLessThan(10_000);
    }
    expect(docIds.size).toBe(4);
    for (const key of keysUploaded()) expect(key).toMatch(/^presentations\/[^/]+\.json$/);
  });

  it("un modèle masqué n'est jamais recréé", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    h.rows[0].templateHiddenAt = new Date();
    h.uploadFile.mockClear();
    await ensureSeededTemplates(ORG_A, USER);
    expect(h.rows).toHaveLength(4);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("n'efface rien en stockage", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});

describe("listTemplates", () => {
  it("la liste d'une organisation ne contient aucun modèle d'une autre", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    await ensureSeededTemplates(ORG_B, USER);
    const a = await listTemplates(ORG_A, { includeHidden: true });
    expect(a).toHaveLength(4);
    expect(a.every((r) => r.organizationId === ORG_A)).toBe(true);
  });

  it("masque les modèles masqués sauf demande, et exclut les présentations ordinaires", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    h.rows[0].templateHiddenAt = new Date();
    h.rows.push({ id: "x", organizationId: ORG_A, isTemplate: false, spaceId: "s" });
    expect(await listTemplates(ORG_A, { includeHidden: false })).toHaveLength(3);
    expect(await listTemplates(ORG_A, { includeHidden: true })).toHaveLength(4);
  });
});

describe("cloneTemplatePayload", () => {
  const seeded = async () => {
    await ensureSeededTemplates(ORG_A, USER);
    h.uploadFile.mockClear();
    return h.rows.find((r) => r.templateSeedKey === "pitch") as { id: string; templateSeedKey: string };
  };

  it("duplique vers le nouvel id sans jamais écrire sous la clé du modèle", async () => {
    const tpl = await seeded();
    const stored = createEmptyDeck("Stocké");
    h.getFileJson.mockResolvedValue(stored);
    const { deck } = await cloneTemplatePayload(tpl, "nouveau-id", "Mon pitch");
    expect(h.getFileJson).toHaveBeenCalledWith(`presentations/${tpl.id}.json`);
    expect(keysUploaded()).toEqual(["presentations/nouveau-id.json"]);
    expect(keysUploaded()).not.toContain(`presentations/${tpl.id}.json`);
    expect(deck.title).toBe("Mon pitch");
    expect(deck.docId).not.toBe(stored.docId);
    expect(uploaded(0).title).toBe("Mon pitch");
  });

  it("se replie sur le JSON du dépôt quand S3 rend null", async () => {
    const tpl = await seeded();
    h.getFileJson.mockResolvedValue(null);
    const { deck } = await cloneTemplatePayload(tpl, "n2", "Copie");
    expect(deck.slides).toHaveLength(getLorIAxTemplate("pitch")!.deck.slides.length);
    expect(keysUploaded()).toEqual(["presentations/n2.json"]);
  });

  it("sans repli possible (modèle d'organisation absent de S3), rend un document vide", async () => {
    h.getFileJson.mockResolvedValue(null);
    const { deck } = await cloneTemplatePayload({ id: "m1", templateSeedKey: null }, "n3", "Vide");
    expect(deck.slides.length).toBeGreaterThan(0);
  });
});

describe("copyPresentationAsTemplate", () => {
  it("crée une copie sans toucher à la source", async () => {
    const source = { id: "src-1", spaceId: "space-1", version: 7, isTemplate: false, organizationId: null, title: "Source" };
    h.rows.push({ ...source });
    h.getFileJson.mockResolvedValue(createEmptyDeck("Source"));
    const copy = await copyPresentationAsTemplate(source, ORG_A, {
      name: "Mon modèle",
      description: "Desc",
      createdBy: USER,
    });
    expect(copy.isTemplate).toBe(true);
    expect(copy.organizationId).toBe(ORG_A);
    expect(copy.spaceId).toBeNull();
    expect(copy.templateOrigin).toBeNull();
    expect(copy.version).toBe(1);
    expect(copy.title).toBe("Mon modèle");
    expect(copy.templateDescription).toBe("Desc");
    expect(copy.id).not.toBe("src-1");
    // source intacte, aucun upload sous sa clé
    expect(h.rows.find((r) => r.id === "src-1")).toEqual(source);
    expect(keysUploaded()).toEqual([`presentations/${copy.id}.json`]);
    expect(keysUploaded()).not.toContain("presentations/src-1.json");
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});

describe("copyPresentationAsTemplate, cas d'erreur", () => {
  const source = { id: "src-2" };

  it("objet S3 de la source absent : erreur explicite, aucune ligne ni objet créés", async () => {
    h.getFileJson.mockResolvedValue(null);
    await expect(
      copyPresentationAsTemplate(source, ORG_A, { name: "X", createdBy: USER })
    ).rejects.toBeInstanceOf(SourceDeckMissingError);
    expect(h.rows).toHaveLength(0);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("écriture S3 en échec : la ligne est masquée (jamais supprimée) et l'erreur remonte", async () => {
    h.getFileJson.mockResolvedValue(createEmptyDeck("Source"));
    h.uploadFile.mockRejectedValueOnce(new Error("S3 HS"));
    await expect(
      copyPresentationAsTemplate(source, ORG_A, { name: "X", createdBy: USER })
    ).rejects.toThrow("S3 HS");
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].templateHiddenAt).toBeInstanceOf(Date);
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});

describe("resetTemplate", () => {
  it("remplace le contenu par le JSON du dépôt, démasque et incrémente la version", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    const tpl = h.rows.find((r) => r.templateSeedKey === "training")!;
    tpl.templateHiddenAt = new Date();
    h.uploadFile.mockClear();
    const res = await resetTemplate(tpl as never, ORG_A);
    expect(res.status).toBe("ok");
    expect(tpl.templateHiddenAt).toBeNull();
    expect(tpl.version).toBe(2);
    const written = h.uploadFile.mock.calls.find((c) => c[0] === `presentations/${tpl.id}.json`)!;
    const deck = JSON.parse((written[1] as Buffer).toString());
    expect(deck.slides).toHaveLength(getLorIAxTemplate("training")!.deck.slides.length);
    expect(typeof deck.docId).toBe("string");
    expect(h.uploadFile.mock.calls.some((c) => c[0] === `presentations/${tpl.id}/v2.json`)).toBe(true);
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("refuse (non réinitialisable) un modèle qui n'est pas d'origine LorIAx", async () => {
    h.rows.push({ id: "own", organizationId: ORG_A, isTemplate: true, templateOrigin: null, templateSeedKey: null, version: 1 });
    const res = await resetTemplate(h.rows[0] as never, ORG_A);
    expect(res.status).toBe("not-resettable");
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.rows[0].version).toBe(1);
  });

  it("ne touche pas un modèle d'une autre organisation", async () => {
    await ensureSeededTemplates(ORG_B, USER);
    h.uploadFile.mockClear();
    const res = await resetTemplate(h.rows[0] as never, ORG_A);
    expect(res.status).toBe("not-found");
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("signale un conflit de version sans écrire en S3", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    h.uploadFile.mockClear();
    const stale = { ...h.rows[0], version: 99 };
    const res = await resetTemplate(stale as never, ORG_A);
    expect(res.status).toBe("conflict");
    expect(h.uploadFile).not.toHaveBeenCalled();
  });
});

describe("modèles livrés", () => {
  it("le semis couvre exactement les modèles du dépôt", async () => {
    await ensureSeededTemplates(ORG_A, USER);
    expect(h.rows.map((r) => r.templateSeedKey).sort()).toEqual(
      LORIAX_TEMPLATES.map((t) => t.seedKey).sort()
    );
  });
});
