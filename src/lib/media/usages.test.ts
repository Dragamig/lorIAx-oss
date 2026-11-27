import { describe, it, expect, vi, beforeEach } from "vitest";

const selectResults: unknown[][] = [];
const insertValues = vi.fn();
const deleteWhere = vi.fn();

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const k of ["from", "where", "innerJoin"]) c[k] = () => c;
  c.limit = () => Promise.resolve(result());
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(() => selectResults.shift() ?? []),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({
      where: (w: unknown) => {
        deleteWhere(w);
        return Promise.resolve();
      },
    }),
  },
}));

import { extractMediaRefs, syncContentUsages, syncDocumentUsages } from "./usages";

const A = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const B = "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a";
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("extractMediaRefs", () => {
  it("reconnaît une URL studio", () => {
    expect(extractMediaRefs(`![a](/api/studio/images/${A})`)).toEqual([{ mediaId: A }]);
    expect(extractMediaRefs(`https://autre.tld/api/studio/images/${A}`)).toEqual([]);
  });
  it("Markdown", () => {
    expect(extractMediaRefs(`![a](/api/media/${A})`)).toEqual([{ mediaId: A }]);
  });
  it("HTML attachments", () => {
    expect(extractMediaRefs(`<img src="/api/attachments/${A}/${B}.png">`)).toEqual([
      { storageKey: `${A}/${B}.png` },
    ]);
  });
  it("ignore ?download=1 et accepte les majuscules", () => {
    expect(extractMediaRefs(`[f](/api/media/${A.toUpperCase()}?download=1)`)).toEqual([
      { mediaId: A },
    ]);
  });
  it("vignette", () => {
    expect(extractMediaRefs(`/api/media/${A}/thumbnail`)).toEqual([{ mediaId: A }]);
  });
  it("dédoublonne", () => {
    expect(extractMediaRefs(`/api/media/${A} et "/api/media/${A}/signed"`)).toHaveLength(1);
  });
  it("ignore une URL absolue d'un autre domaine", () => {
    expect(extractMediaRefs(`https://autre.example/api/media/${A}`)).toEqual([]);
  });
  it("reconnaît mediaId en JSON", () => {
    expect(extractMediaRefs([{ mediaId: A, filename: "a.pdf" }])).toEqual([{ mediaId: A }]);
    expect(extractMediaRefs(`[{"mediaId":"${B}"}]`)).toEqual([{ mediaId: B }]);
  });
  it("texte sans référence", () => {
    expect(extractMediaRefs("bonjour")).toEqual([]);
  });
  it("une clé terminée par une parenthèse ne l'inclut pas", () => {
    expect(extractMediaRefs(`![x](/api/attachments/${A}/${B}.png)`)).toEqual([
      { storageKey: `${A}/${B}.png` },
    ]);
  });
});

const target = { targetType: "document" as const, targetId: A, organizationId: ORG, spaceId: null };

describe("syncContentUsages", () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertValues.mockClear();
    deleteWhere.mockClear();
  });

  it("ajoute une référence nouvelle", async () => {
    selectResults.push([{ id: B, organizationId: ORG, storageKey: "k" }], []);
    const r = await syncContentUsages(target, [{ mediaId: B }]);
    expect(r).toEqual({ added: 1, removed: 0, ignored: 0 });
    expect(insertValues.mock.calls[0][0][0]).toMatchObject({ mediaId: B, source: "content" });
  });

  it("retire une ligne content qui n'est plus référencée", async () => {
    selectResults.push([{ id: B, organizationId: ORG, storageKey: "k" }], [
      { id: "u1", mediaId: B },
      { id: "u2", mediaId: A },
    ]);
    const r = await syncContentUsages(target, [{ mediaId: B }]);
    expect(r).toEqual({ added: 0, removed: 1, ignored: 0 });
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("sans référence : ne résout rien, retire tout, ne touche pas explicit (filtré par source)", async () => {
    selectResults.push([{ id: "u1", mediaId: A }]);
    const r = await syncContentUsages(target, []);
    expect(r.removed).toBe(1);
  });

  it("média d'une autre organisation : ignoré, jamais inséré", async () => {
    selectResults.push([{ id: B, organizationId: OTHER, storageKey: "k" }], []);
    const r = await syncContentUsages(target, [{ mediaId: B }]);
    expect(r).toEqual({ added: 0, removed: 0, ignored: 1 });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("média en corbeille : usage conservé", async () => {
    selectResults.push([{ id: B, organizationId: ORG, storageKey: "k" }], [{ id: "u1", mediaId: B }]);
    const r = await syncContentUsages(target, [{ mediaId: B }]);
    expect(r).toEqual({ added: 0, removed: 0, ignored: 0 });
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("uuid inexistant : ignoré sans erreur", async () => {
    selectResults.push([], []);
    const r = await syncContentUsages(target, [{ mediaId: B }]);
    expect(r).toEqual({ added: 0, removed: 0, ignored: 1 });
  });

  it("résout une clé de stockage", async () => {
    selectResults.push([{ id: B, organizationId: ORG, storageKey: "s/k.png" }], []);
    const r = await syncContentUsages(target, [{ storageKey: "s/k.png" }]);
    expect(r.added).toBe(1);
  });
});

describe("syncDocumentUsages", () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertValues.mockClear();
  });
  it("document introuvable : ne fait rien", async () => {
    selectResults.push([]);
    await syncDocumentUsages(A);
    expect(insertValues).not.toHaveBeenCalled();
  });
  it("synchronise avec l'organisation de l'espace", async () => {
    selectResults.push(
      [{ contentText: `/api/media/${B}`, spaceId: OTHER, organizationId: ORG }],
      [{ id: B, organizationId: ORG, storageKey: "k" }],
      [],
    );
    await syncDocumentUsages(A);
    expect(insertValues.mock.calls[0][0][0]).toMatchObject({ targetId: A, spaceId: OTHER });
  });
});
