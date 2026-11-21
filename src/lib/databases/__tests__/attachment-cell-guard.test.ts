import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  types: {} as Record<string, string>,
  media: {} as Record<string, unknown>,
  allowed: true,
}));

vi.mock("../row-writes", () => ({ loadColumnTypes: vi.fn(async () => h.types) }));
vi.mock("@/lib/media/access", () => ({
  getMediaForAccess: vi.fn(async (id: string) => h.media[id] ?? null),
  resolveMediaAccess: vi.fn(async () => ({ allowed: h.allowed })),
}));

import { validateAttachmentCells, assertMediaCells, MediaCellError } from "../attachment-cell-guard";

const user = { id: "u1" } as never;
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const piece = (mediaId: string) => ({ mediaId, filename: "a.pdf", mimeType: "application/pdf", size: 1 });

beforeEach(() => {
  h.types = { col: "attachment", rel: "relation" };
  h.media = { [M1]: { id: M1 }, [M2]: { id: M2 } };
  h.allowed = true;
});

describe("validateAttachmentCells", () => {
  it("accepte la nouvelle forme", async () => {
    expect(await validateAttachmentCells("d", { col: [piece(M1), piece(M2)] }, user, "o")).toEqual({ ok: true });
  });

  it("accepte les anciennes formes, avec ou sans key, même au plafond", async () => {
    const legacy = [{ key: "u/x.pdf", filename: "x" }, { filename: "sans-cle" }, null, {}];
    expect(await validateAttachmentCells("d", { col: legacy }, user, "o")).toEqual({ ok: true });
  });

  it("refuse 21 pièces et accepte 20", async () => {
    const mk = (n: number) => Array.from({ length: n }, () => piece(M1));
    expect(await validateAttachmentCells("d", { col: mk(20) }, user, "o")).toEqual({ ok: true });
    const r = await validateAttachmentCells("d", { col: mk(21) }, user, "o");
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("refuse un mediaId absent ou illisible (autre organisation)", async () => {
    expect(await validateAttachmentCells("d", { col: [piece("33333333-3333-4333-8333-333333333333")] }, user, "o")).toMatchObject({ ok: false });
    h.allowed = false;
    expect(await validateAttachmentCells("d", { col: [piece(M1)] }, user, "o")).toMatchObject({ ok: false, status: 400 });
  });

  it("ignore les colonnes qui ne sont pas des pièces jointes", async () => {
    h.allowed = false;
    expect(await validateAttachmentCells("d", { rel: [piece(M1)] }, user, "o")).toEqual({ ok: true });
  });

  it("ne lit pas les colonnes pour une cellule sans pièce", async () => {
    expect(await validateAttachmentCells("d", { col: ["a"], other: 3 }, user, "o")).toEqual({ ok: true });
  });

  it("colonne image : un /api/media/<id> illisible est refusé, lisible accepté", async () => {
    h.types = { img: "image" };
    expect(await validateAttachmentCells("d", { img: `/api/media/${M1}` }, user, "o")).toEqual({ ok: true });
    h.allowed = false;
    expect(await validateAttachmentCells("d", { img: `/api/media/${M1}` }, user, "o")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("colonne image : formes héritées et externes acceptées sans contrôle", async () => {
    h.types = { img: "image" };
    h.allowed = false;
    for (const v of ["/api/attachments/u/x.png", "https://x/y.png", "data:image/png;base64,AAA", "", null]) {
      expect(await validateAttachmentCells("d", { img: v }, user, "o")).toEqual({ ok: true });
    }
  });

  it("colonne image : un mediaId inexistant est refusé", async () => {
    h.types = { img: "image" };
    const r = await validateAttachmentCells("d", { img: "/api/media/33333333-3333-4333-8333-333333333333" }, user, "o");
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe("validateAttachmentCells : valeur de référence", () => {
  it("ne contrôle pas une pièce déjà enregistrée, mais contrôle la nouvelle", async () => {
    h.allowed = false;
    const known = { col: [piece(M1)] };
    expect(await validateAttachmentCells("d", { col: [piece(M1)] }, user, "o", known)).toEqual({ ok: true });
    expect(await validateAttachmentCells("d", { col: [piece(M1), piece(M2)] }, user, "o", known)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("le plafond de 20 s'applique au total malgré la référence", async () => {
    const known = { col: [piece(M1)] };
    const r = await validateAttachmentCells("d", { col: Array.from({ length: 21 }, () => piece(M1)) }, user, "o", known);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("colonne image : l'image déjà en place passe, une autre est contrôlée", async () => {
    h.types = { img: "image" };
    h.allowed = false;
    const known = { img: `/api/media/${M1}` };
    expect(await validateAttachmentCells("d", { img: `/api/media/${M1}` }, user, "o", known)).toEqual({ ok: true });
    expect(await validateAttachmentCells("d", { img: `/api/media/${M2}` }, user, "o", known)).toMatchObject({ ok: false });
  });
});

describe("assertMediaCells", () => {
  it("ne fait rien sans garde", async () => {
    h.allowed = false;
    await expect(assertMediaCells("d", { col: [piece(M1)] }, undefined)).resolves.toBeUndefined();
  });

  it("lève MediaCellError (400) quand le média est illisible", async () => {
    h.allowed = false;
    await expect(assertMediaCells("d", { col: [piece(M1)] }, { user, orgId: "o" })).rejects.toBeInstanceOf(MediaCellError);
  });

  it("sans acteur identifiable : toute référence de média est refusée", async () => {
    await expect(assertMediaCells("d", { col: [piece(M1)] }, { user: null, orgId: "o" })).rejects.toBeInstanceOf(MediaCellError);
    await expect(assertMediaCells("d", { col: ["texte"] }, { user: null, orgId: "o" })).resolves.toBeUndefined();
  });

  it("accepte une écriture valide", async () => {
    await expect(assertMediaCells("d", { col: [piece(M1)] }, { user, orgId: "o" })).resolves.toBeUndefined();
  });
});

describe("neutralizeUnreadableMediaCells (duplication)", () => {
  it("retire les pièces et vide l'image illisibles, garde le reste", async () => {
    const { neutralizeUnreadableMediaCells } = await import("../attachment-cell-guard");
    h.allowed = false;
    h.types = { col: "attachment", img: "image", t: "text" };
    const legacy = { key: "u/x.pdf", filename: "x" };
    const rows = [{ col: [piece(M1), legacy], img: `/api/media/${M1}`, t: "/api/media/" + M1 }];
    const [out] = await neutralizeUnreadableMediaCells(h.types, rows, user, "o");
    expect(out.col).toEqual([legacy]);
    expect(out.img).toBe("");
    expect(out.t).toBe("/api/media/" + M1);
  });

  it("conserve les médias lisibles et les formes externes", async () => {
    const { neutralizeUnreadableMediaCells } = await import("../attachment-cell-guard");
    h.allowed = true;
    h.types = { col: "attachment", img: "image" };
    const rows = [{ col: [piece(M1)], img: "https://x/y.png" }, { col: [], img: `/api/media/${M2}` }];
    expect(await neutralizeUnreadableMediaCells(h.types, rows, user, "o")).toEqual(rows);
  });

  it("un média absent (autre organisation, supprimé) est neutralisé", async () => {
    const { neutralizeUnreadableMediaCells } = await import("../attachment-cell-guard");
    h.types = { col: "attachment" };
    const ghost = piece("33333333-3333-4333-8333-333333333333");
    const [out] = await neutralizeUnreadableMediaCells(h.types, [{ col: [ghost, piece(M1)] }], user, "o");
    expect(out.col).toEqual([piece(M1)]);
  });
});
