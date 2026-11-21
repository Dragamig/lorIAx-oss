import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  LegacyTally,
  cellLegacyKeys,
  classifyCopy,
  classifyKey,
  designThumbnailKeys,
  exitCodeFor,
  legacyKeysInText,
  logoLegacyKeys,
  timelineLegacyKeys,
} from "./legacy-refs";

describe("classifyKey", () => {
  it("sépare résolvable, introuvable et ambigu", () => {
    expect(classifyKey(1)).toBe("resolvable");
    expect(classifyKey(0)).toBe("missing");
    expect(classifyKey(2)).toBe("ambiguous");
  });
});

describe("classifyCopy", () => {
  it("copiée par id gagne sur la clé", () => {
    expect(classifyCopy({ idMatch: true, keyMatch: true })).toBe("copied_by_id");
    expect(classifyCopy({ idMatch: true, keyMatch: false })).toBe("copied_by_id");
  });
  it("clé seule : atteignable, pas bloquant", () => {
    expect(classifyCopy({ idMatch: false, keyMatch: true })).toBe("copied_by_key");
  });
  it("ni id ni clé : orpheline inaccessible", () => {
    expect(classifyCopy({ idMatch: false, keyMatch: false })).toBe("orphan_unreachable");
    expect(classifyCopy({ idMatch: false, keyMatch: false })).toBe("orphan_unreachable");
  });
  it("clé portée par une autre organisation : à part, non bloquant", () => {
    expect(classifyCopy({ idMatch: false, keyMatch: false, keyOtherOrg: true })).toBe("copied_by_key_other_org");
  });
  it("studio : la clé n'est pas servie, id seul", () => {
    expect(classifyCopy({ idMatch: false, keyMatch: true }, { idOnly: true })).toBe("orphan_unreachable");
    expect(classifyCopy({ idMatch: true, keyMatch: false }, { idOnly: true })).toBe("copied_by_id");
  });
});

describe("extraction de clés", () => {
  it("texte : décode, déduplique, ignore la forme neuve et les URL absolues", () => {
    const t = "![a](/api/attachments/sp/a%20b.png) ![b](/api/attachments/sp/a%20b.png) ![c](/api/media/x) https://h/api/attachments/no";
    expect(legacyKeysInText(t)).toEqual(["sp/a b.png"]);
    expect(legacyKeysInText("rien")).toEqual([]);
  });
  it("cellules image et pièces jointes, seulement les colonnes concernées", () => {
    const cols = [
      { id: "i", type: "image" as const },
      { id: "a", type: "attachment" as const },
    ];
    const cells = {
      i: "/api/attachments/k/1.png",
      a: [{ key: "k/2.pdf" }, { mediaId: "m" }, { key: "k/3.pdf" }],
      other: "/api/attachments/k/4",
    };
    expect(cellLegacyKeys(cells, cols).sort()).toEqual(["k/1.png", "k/2.pdf", "k/3.pdf"]);
    expect(cellLegacyKeys({ i: "/api/media/x", a: "x" }, cols)).toEqual([]);
  });
  it("timeline : sourceKey sans mediaId seulement", () => {
    const tl = { tracks: [{ clips: [{ sourceKey: "a" }, { sourceKey: "b", mediaId: "m" }, { sourceKey: "" }] }, { clips: [{ sourceKey: "c" }] }] };
    expect(timelineLegacyKeys(tl).sort()).toEqual(["a", "c"]);
    expect(timelineLegacyKeys({ tracks: "cassé" })).toEqual([]);
    expect(timelineLegacyKeys(null)).toEqual([]);
  });
  it("logos du Brand Kit", () => {
    expect(logoLegacyKeys([{ url: "/api/attachments/b/l.png", name: "x" }, { url: "/api/media/m", name: "y" }, { url: 3 }])).toEqual(["b/l.png"]);
    expect(logoLegacyKeys(null)).toEqual([]);
  });
  it("miniatures de blocs design dans l'état Yjs", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    const el = new Y.XmlElement("designBlock");
    el.setAttribute("thumbnailUrl", "/api/attachments/d/t.png");
    const img = new Y.XmlElement("image");
    img.setAttribute("src", "/api/attachments/d/i.png");
    frag.insert(0, [el, img]);
    expect(designThumbnailKeys(doc)).toEqual(["d/t.png"]);
  });
});

describe("LegacyTally et code de sortie", () => {
  it("agrège par surface et statut, compte les lignes touchées", () => {
    const t = new LegacyTally();
    t.addRow("content_text", ["a", "b"], (k) => (k === "a" ? "resolvable" : "missing"));
    t.addRow("content_text", [], () => "missing");
    t.addRow("cells", ["c"], () => "ambiguous");
    const j = t.toJSON();
    expect(j.content_text).toEqual({ resolvable: 1, missing: 1, ambiguous: 0, rows: 1 });
    expect(j.cells).toEqual({ resolvable: 0, missing: 0, ambiguous: 1, rows: 1 });
    expect(j.timeline).toEqual({ resolvable: 0, missing: 0, ambiguous: 0, rows: 0 });
  });
  it("code 2 dès qu'une orpheline d'attachments est inaccessible, jamais pour studio_images", () => {
    expect(exitCodeFor({ attachmentsOrphans: 0 })).toBe(0);
    expect(exitCodeFor({ attachmentsOrphans: 1 })).toBe(2);
  });
});
