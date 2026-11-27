import { describe, expect, it } from "vitest";
import {
  checkReferenceGuard,
  classifyDocument,
  collectMarkdownKeys,
  diskDifferenceIsOnlyRefs,
  normalizeMarkdown,
  substituteResolvedRefs,
  toReportOutcome,
  type CollabReportEntry,
} from "./collab-plan";

const base = { idleMinutes: 60, minIdle: 10 };

describe("classifyDocument", () => {
  it("rien à réécrire et contenu déjà égal : skip_clean", () => {
    expect(classifyDocument({ ...base, stateHasResolvable: false, contentInSync: true })).toBe("skip_clean");
  });
  it("rien à réécrire mais disque ou content_text différent : resync_markdown, même si l'état a bougé à l'instant", () => {
    expect(classifyDocument({ ...base, stateHasResolvable: false, contentInSync: false })).toBe("resync_markdown");
    expect(classifyDocument({ stateHasResolvable: false, contentInSync: false, idleMinutes: 0, minIdle: 10 })).toBe(
      "resync_markdown"
    );
  });
  it("clés résolvables et inactif : rewrite_state, quel que soit le contenu", () => {
    expect(classifyDocument({ ...base, stateHasResolvable: true, contentInSync: true })).toBe("rewrite_state");
    expect(classifyDocument({ ...base, stateHasResolvable: true, contentInSync: false })).toBe("rewrite_state");
  });
  it("clés résolvables et récemment modifié : skip_active", () => {
    expect(classifyDocument({ stateHasResolvable: true, contentInSync: false, idleMinutes: 3, minIdle: 10 })).toBe(
      "skip_active"
    );
  });
  it("seuil inclus : exactement minIdle minutes suffit", () => {
    expect(classifyDocument({ stateHasResolvable: true, contentInSync: true, idleMinutes: 10, minIdle: 10 })).toBe(
      "rewrite_state"
    );
  });
  it("minIdle 0 ne bloque jamais", () => {
    expect(classifyDocument({ stateHasResolvable: true, contentInSync: true, idleMinutes: 0, minIdle: 0 })).toBe(
      "rewrite_state"
    );
  });
});

describe("normalizeMarkdown", () => {
  it("fins de ligne et espace final seulement", () => {
    expect(normalizeMarkdown("a\r\nb  \n\n")).toBe("a\nb");
    expect(normalizeMarkdown("a  b")).toBe("a  b");
  });
});

describe("collectMarkdownKeys et substituteResolvedRefs", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const design = (u: string) => `<div designid="d1" thumbnailurl="${u}" data-type="design-block"></div>`;

  it("collecte les URL anciennes décodées et les miniatures design en clé nue", () => {
    const md = `![a](/api/attachments/sp/a%20b.png)\n${design("org/t.png")}\n${design("/api/media/" + ID)}`;
    expect(collectMarkdownKeys(md).sort()).toEqual(["org/t.png", "sp/a b.png"]);
    expect(collectMarkdownKeys(null)).toEqual([]);
  });
  it("substitue les clés résolues, laisse les autres", () => {
    const map = new Map([["a.png", ID], ["org/t.png", ID]]);
    const md = `![a](/api/attachments/a.png) ![b](/api/attachments/b.png)\n${design("org/t.png")}\n${design("org/z.png")}`;
    expect(substituteResolvedRefs(md, map)).toBe(
      `![a](/api/media/${ID}) ![b](/api/attachments/b.png)\n${design("/api/media/" + ID)}\n${design("org/z.png")}`
    );
  });
  it("une clé de miniature hors d'une balise design-block n'est pas touchée", () => {
    const md = '<div thumbnailurl="org/t.png" data-type="other"></div>';
    expect(substituteResolvedRefs(md, new Map([["org/t.png", ID]]))).toBe(md);
  });
});

describe("diskDifferenceIsOnlyRefs", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const map = new Map([["a.png", ID]]);
  it("seule différence : l'URL résolue", () => {
    expect(diskDifferenceIsOnlyRefs("![a](/api/attachments/a.png)\n", `![a](/api/media/${ID})\n`, map)).toBe(true);
  });
  it("tolère fins de ligne et espace final", () => {
    expect(diskDifferenceIsOnlyRefs("x\r\n![a](/api/attachments/a.png)  \r\n", `x\n![a](/api/media/${ID})`, map)).toBe(true);
  });
  it("structure perdue par la régénération : refusé", () => {
    expect(diskDifferenceIsOnlyRefs("| H1 | H2 |\n|---|---|\n| a | b |\n", "H1H2ab\n", map)).toBe(false);
  });
  it("URL non résolue encore présente d'un côté seulement : refusé", () => {
    expect(diskDifferenceIsOnlyRefs("![a](/api/attachments/zz.png)", "![a](/api/media/" + ID + ")", map)).toBe(false);
  });
});

describe("checkReferenceGuard", () => {
  it("égal accepté", () => {
    expect(checkReferenceGuard(["a", "b"], ["a", "b"])).toBe(true);
  });
  it("supérieur accepté", () => {
    expect(checkReferenceGuard(["a"], ["a", "b"])).toBe(true);
  });
  it("inférieur refusé", () => {
    expect(checkReferenceGuard(["a", "b"], ["a"])).toBe(false);
  });
  it("même nombre mais référence perdue : refusé", () => {
    expect(checkReferenceGuard(["a", "b"], ["a", "c"])).toBe(false);
  });
  it("ordre indifférent", () => {
    expect(checkReferenceGuard(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });
  it("références dédupliquées", () => {
    expect(checkReferenceGuard(["a", "a", "b"], ["b", "a"])).toBe(true);
    expect(checkReferenceGuard(["a", "b"], ["a", "a", "a"])).toBe(false);
  });
  it("vide : accepté", () => {
    expect(checkReferenceGuard([], [])).toBe(true);
    expect(checkReferenceGuard([], ["a"])).toBe(true);
  });
});

describe("CollabReportEntry", () => {
  it("est sérialisable et sans tiret cadratin", () => {
    const e: CollabReportEntry = {
      documentId: "d1",
      orgId: "o1",
      status: "markdown_stale",
      rewritten: 3,
      skipped: 0,
      reason: "écriture disque échouée",
    };
    const json = JSON.stringify(e);
    expect(JSON.parse(json)).toEqual(e);
    expect(json).not.toMatch(/[\u2013\u2014]/);
  });
  it("chaque statut se projette sur une issue de Report", () => {
    expect(toReportOutcome("rewritten")).toBe("rewritten");
    expect(toReportOutcome("resynced")).toBe("rewritten");
    expect(toReportOutcome("skip_clean")).toBe("unchanged");
    expect(toReportOutcome("skip_active")).toBe("skipped_concurrent");
    expect(toReportOutcome("skipped_concurrent")).toBe("skipped_concurrent");
    expect(toReportOutcome("skipped_guard")).toBe("unparseable");
    expect(toReportOutcome("disk_diverged")).toBe("unparseable");
    expect(toReportOutcome("markdown_stale")).toBe("unparseable");
    expect(toReportOutcome("error")).toBe("unparseable");
  });
});

describe("substituteResolvedRefs, URL studio", () => {
  it("réécrit /api/studio/images/<uuid> en /api/media/<uuid> sans carte", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(substituteResolvedRefs(`![a](/api/studio/images/${id})`, new Map())).toBe(`![a](/api/media/${id})`);
  });
});
