import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  collectLegacyKeys,
  applyKeyMap,
  rewriteYDocMediaRefs,
  countStudioRefs,
  applyStudioRefs,
} from "./rewrite-media-refs";
import type { LookupResult } from "@/lib/media/rewrite-document-refs";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

function el(name: string, attrs: Record<string, unknown> = {}) {
  const e = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v as string);
  return e;
}

function build(build: (frag: Y.XmlFragment) => void) {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  build(frag);
  return doc;
}

function attr(doc: Y.Doc, path: number[], name: string) {
  let node: Y.XmlFragment | Y.XmlElement = doc.getXmlFragment("default");
  for (const i of path) node = node.get(i) as Y.XmlElement;
  return (node as Y.XmlElement).getAttribute(name);
}

describe("collectLegacyKeys", () => {
  it("document vide", () => {
    expect(collectLegacyKeys(new Y.Doc())).toEqual([]);
  });

  it("collecte, décode et déduplique en ordre stable, récursivement", () => {
    const doc = build((f) => {
      const cell = el("tableCell");
      cell.insert(0, [el("image", { src: "/api/attachments/org%2Fa%20b.png" })]);
      const table = el("table");
      table.insert(0, [cell]);
      f.insert(0, [
        el("image", { src: "/api/attachments/x.png" }),
        table,
        el("image", { src: "/api/attachments/x.png" }),
        el("image", { src: "https://autre.site/api/attachments/y" }),
        el("image", { src: "/foo/api/attachments/z" }),
      ]);
    });
    expect(collectLegacyKeys(doc)).toEqual(["x.png", "org/a b.png"]);
  });

  it("lit les marques de lien", () => {
    const doc = build((f) => {
      const p = el("paragraph");
      const t = new Y.XmlText();
      p.insert(0, [t]);
      f.insert(0, [p]);
      t.insert(0, "voir ");
      t.insert(5, "fichier", { link: { href: "/api/attachments/k.pdf", title: null } });
    });
    expect(collectLegacyKeys(doc)).toEqual(["k.pdf"]);
  });
});

describe("applyKeyMap", () => {
  it("réécrit image, thumbnailUrl et attribut chaîne", () => {
    const doc = build((f) => {
      f.insert(0, [
        el("image", { src: "/api/attachments/a.png" }),
        el("design", { thumbnailUrl: "/api/attachments/org/t.png", other: "x /api/attachments/a.png y" }),
      ]);
    });
    const r = applyKeyMap(doc, new Map([["a.png", ID1], ["org/t.png", ID2]]));
    expect(r).toEqual({ rewritten: 3, skipped: 0 });
    expect(attr(doc, [0], "src")).toBe(`/api/media/${ID1}`);
    expect(attr(doc, [1], "thumbnailUrl")).toBe(`/api/media/${ID2}`);
    expect(attr(doc, [1], "other")).toBe(`x /api/media/${ID1} y`);
  });

  it("deux occurrences de la même clé", () => {
    const doc = build((f) =>
      f.insert(0, [el("image", { src: "/api/attachments/a.png" }), el("image", { src: "/api/attachments/a.png" })]),
    );
    expect(applyKeyMap(doc, new Map([["a.png", ID1]])).rewritten).toBe(2);
    expect(attr(doc, [1], "src")).toBe(`/api/media/${ID1}`);
  });

  it("clé absente de la carte (introuvable ou ambiguë) : inchangée et comptée", () => {
    const doc = build((f) => f.insert(0, [el("image", { src: "/api/attachments/zz.png" })]));
    expect(applyKeyMap(doc, new Map())).toEqual({ rewritten: 0, skipped: 1 });
    expect(attr(doc, [0], "src")).toBe("/api/attachments/zz.png");
  });

  it("URL absolue, chemin imbriqué et valeur non chaîne inchangés", () => {
    const doc = build((f) =>
      f.insert(0, [
        el("image", {
          a: "https://autre.site/api/attachments/x",
          b: "/foo/api/attachments/x",
          c: 42 as unknown as string,
        }),
      ]),
    );
    const map = new Map([["x", ID1]]);
    expect(applyKeyMap(doc, map)).toEqual({ rewritten: 0, skipped: 0 });
    expect(attr(doc, [0], "a")).toBe("https://autre.site/api/attachments/x");
    expect(attr(doc, [0], "b")).toBe("/foo/api/attachments/x");
    expect(attr(doc, [0], "c")).toBe(42);
  });

  it("texte brut contenant l'URL inchangé, lien réécrit avec attributs conservés", () => {
    const doc = build((f) => {
      const p = el("paragraph");
      const t = new Y.XmlText();
      p.insert(0, [t]);
      f.insert(0, [p]);
      t.insert(0, "voir /api/attachments/k.pdf et ");
      t.insert(t.length, "fichier", { link: { href: "/api/attachments/k.pdf", title: "T" } });
    });
    const r = applyKeyMap(doc, new Map([["k.pdf", ID1]]));
    expect(r.rewritten).toBe(1);
    const delta = ((doc.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText).toDelta();
    expect(delta[0].insert).toBe("voir /api/attachments/k.pdf et ");
    expect(delta[1].attributes.link).toEqual({ href: `/api/media/${ID1}`, title: "T" });
  });

  it("image imbriquée à plusieurs niveaux", () => {
    const doc = build((f) => {
      const img = el("image", { src: "/api/attachments/deep.png" });
      const col = el("column");
      col.insert(0, [img]);
      const cols = el("columns");
      cols.insert(0, [col]);
      const cell = el("tableCell");
      cell.insert(0, [cols]);
      f.insert(0, [cell]);
    });
    expect(applyKeyMap(doc, new Map([["deep.png", ID1]])).rewritten).toBe(1);
    expect(attr(doc, [0, 0, 0, 0], "src")).toBe(`/api/media/${ID1}`);
  });

  it("idempotent : seconde passe sans effet ni opération Yjs", () => {
    const doc = build((f) => f.insert(0, [el("image", { src: "/api/attachments/a.png" })]));
    const map = new Map([["a.png", ID1]]);
    applyKeyMap(doc, map);
    const before = Y.encodeStateAsUpdate(doc);
    expect(applyKeyMap(doc, map)).toEqual({ rewritten: 0, skipped: 0 });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("converge sur un second client", () => {
    const doc = build((f) => f.insert(0, [el("image", { src: "/api/attachments/a.png" })]));
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const sv = Y.encodeStateVector(other);
    applyKeyMap(doc, new Map([["a.png", ID1]]));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, sv));
    expect(attr(other, [0], "src")).toBe(`/api/media/${ID1}`);
  });
});

describe("rewriteYDocMediaRefs", () => {
  it("résout puis réécrit, ambigu et manquant ignorés", async () => {
    const doc = build((f) =>
      f.insert(0, [
        el("image", { src: "/api/attachments/a.png" }),
        el("image", { src: "/api/attachments/amb.png" }),
        el("image", { src: "/api/attachments/gone.png" }),
      ]),
    );
    const resolve = async (keys: string[]) => {
      expect(keys).toEqual(["a.png", "amb.png", "gone.png"]);
      return new Map<string, LookupResult>([
        ["a.png", { status: "found", id: ID1 }],
        ["amb.png", { status: "ambiguous" }],
        ["gone.png", { status: "missing" }],
      ]);
    };
    expect(await rewriteYDocMediaRefs(doc, resolve)).toEqual({ rewritten: 1, skipped: 2 });
    expect(attr(doc, [0], "src")).toBe(`/api/media/${ID1}`);
    expect(attr(doc, [1], "src")).toBe("/api/attachments/amb.png");
  });

  it("sans clé : aucun appel au résolveur", async () => {
    let called = false;
    const r = await rewriteYDocMediaRefs(new Y.Doc(), async () => {
      called = true;
      return new Map();
    });
    expect(r).toEqual({ rewritten: 0, skipped: 0 });
    expect(called).toBe(false);
  });
});

describe("miniature de bloc design en clé nue", () => {
  const design = (url: string) => build((f) => f.insert(0, [el("designBlock", { thumbnailUrl: url })]));

  it("collectée et réécrite en /api/media/<id>", () => {
    const doc = design("org/space/thumb.png");
    expect(collectLegacyKeys(doc)).toEqual(["org/space/thumb.png"]);
    expect(applyKeyMap(doc, new Map([["org/space/thumb.png", ID1]]))).toEqual({ rewritten: 1, skipped: 0 });
    expect(attr(doc, [0], "thumbnailUrl")).toBe(`/api/media/${ID1}`);
    expect(collectLegacyKeys(doc)).toEqual([]);
  });

  it("clé nue absente de la carte : inchangée et comptée", () => {
    const doc = design("org/x.png");
    expect(applyKeyMap(doc, new Map())).toEqual({ rewritten: 0, skipped: 1 });
    expect(attr(doc, [0], "thumbnailUrl")).toBe("org/x.png");
  });

  it("data:, http, /api/media et autres éléments ne sont pas des clés", () => {
    for (const v of ["data:image/png;base64,AAA", "https://x.test/a.png", `/api/media/${ID1}`]) {
      expect(collectLegacyKeys(design(v))).toEqual([]);
    }
    const other = build((f) => f.insert(0, [el("custom", { thumbnailUrl: "org/t.png" })]));
    expect(collectLegacyKeys(other)).toEqual([]);
  });
});

describe("anciennes URL /api/studio/images", () => {
  const studio = (id: string) => `/api/studio/images/${id}`;
  const make = () =>
    build((f) => {
      const p = el("paragraph");
      const t = new Y.XmlText();
      p.insert(0, [t]);
      t.insert(0, "lien", { link: { href: studio(ID2), title: null } });
      f.insert(0, [el("image", { src: studio(ID1) }), el("image", { src: "https://x.test/api/studio/images/" + ID1 }), p]);
    });

  it("compte les références (attributs et liens), pas les URL absolues", () => {
    expect(countStudioRefs(make())).toBe(2);
  });

  it("réécrit vers /api/media avec le même identifiant, idempotent", () => {
    const doc = make();
    expect(applyStudioRefs(doc)).toBe(2);
    expect(attr(doc, [0], "src")).toBe(`/api/media/${ID1}`);
    expect(attr(doc, [1], "src")).toBe("https://x.test/api/studio/images/" + ID1);
    expect(applyStudioRefs(doc)).toBe(0);
    expect(countStudioRefs(doc)).toBe(0);
  });

  it("rewriteYDocMediaRefs les réécrit sans résolution", async () => {
    const doc = make();
    const res = await rewriteYDocMediaRefs(doc, async () => new Map());
    expect(res).toEqual({ rewritten: 2, skipped: 0 });
    expect(attr(doc, [0], "src")).toBe(`/api/media/${ID1}`);
  });
});
