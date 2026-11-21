import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { templateContentToYjsState } from "./template-to-yjs";

interface TreeNode {
  type: string;
  attrs: Record<string, string>;
  children: Array<TreeNode | { text: string; delta: unknown }>;
}

function toTree(node: Y.XmlElement | Y.XmlText): TreeNode | { text: string; delta: unknown } {
  if (node instanceof Y.XmlText) {
    return { text: node.toString(), delta: node.toDelta() };
  }
  const el = node as Y.XmlElement;
  return {
    type: el.nodeName,
    attrs: el.getAttributes() as Record<string, string>,
    children: el.toArray().map((c) => toTree(c as Y.XmlElement | Y.XmlText)),
  };
}

/** Décode l'état Yjs binaire en arbre simple pour les assertions. */
function tree(markdown: string): TreeNode[] {
  const state = templateContentToYjsState({ markdown });
  expect(state).not.toBeNull();
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state!);
  const frag = doc.getXmlFragment("default");
  return frag.toArray().map((c) => toTree(c as Y.XmlElement)) as TreeNode[];
}

describe("template-to-yjs — markdown → vrais blocs", () => {
  it("titres avec niveau", () => {
    const [h1, h2] = tree("# Titre\n\n## Sous-titre");
    expect(h1.type).toBe("heading");
    expect(h1.attrs.level).toBe("1");
    expect((h1.children[0] as { text: string }).text).toBe("Titre");
    expect(h2.attrs.level).toBe("2");
  });

  it("liste à puces → bulletList > listItem > paragraph", () => {
    const [list] = tree("- un\n- deux");
    expect(list.type).toBe("bulletList");
    expect(list.children).toHaveLength(2);
    const item = list.children[0] as TreeNode;
    expect(item.type).toBe("listItem");
    expect((item.children[0] as TreeNode).type).toBe("paragraph");
  });

  it("liste numérotée → orderedList", () => {
    const [list] = tree("1. un\n2. deux");
    expect(list.type).toBe("orderedList");
    expect(list.children).toHaveLength(2);
  });

  it("checklist → taskList > taskItem avec checked", () => {
    const [list] = tree("- [ ] à faire\n- [x] fait");
    expect(list.type).toBe("taskList");
    expect((list.children[0] as TreeNode).attrs.checked).toBe("false");
    expect((list.children[1] as TreeNode).attrs.checked).toBe("true");
  });

  it("tableau → table > tableRow > tableHeader/tableCell", () => {
    const [table] = tree("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(table.type).toBe("table");
    expect(table.children).toHaveLength(2); // header + 1 ligne
    const headerRow = table.children[0] as TreeNode;
    expect(headerRow.type).toBe("tableRow");
    expect((headerRow.children[0] as TreeNode).type).toBe("tableHeader");
    const bodyRow = table.children[1] as TreeNode;
    expect((bodyRow.children[0] as TreeNode).type).toBe("tableCell");
  });

  it("citation → blockquote > paragraph", () => {
    const [quote] = tree("> une citation\n> sur deux lignes");
    expect(quote.type).toBe("blockquote");
    expect(quote.children).toHaveLength(2);
    expect((quote.children[0] as TreeNode).type).toBe("paragraph");
  });

  it("image → nœud image avec src/alt", () => {
    const [img] = tree("![Schéma](https://exemple.com/a.png)");
    expect(img.type).toBe("image");
    expect(img.attrs.src).toBe("https://exemple.com/a.png");
    expect(img.attrs.alt).toBe("Schéma");
  });

  it("filet horizontal", () => {
    const nodes = tree("Avant\n\n---\n\nAprès");
    expect(nodes.map((n) => n.type)).toContain("horizontalRule");
  });

  it("chrono placeholder → chronoBlock avec label", () => {
    const [chrono] = tree("[[chrono: Temps de parole]]");
    expect(chrono.type).toBe("chronoBlock");
    expect(chrono.attrs.label).toBe("Temps de parole");
  });

  it("BDD liée placeholder → databaseBlock sans databaseId", () => {
    const [db] = tree("[[bdd: Clients]]");
    expect(db.type).toBe("databaseBlock");
    expect(db.attrs.databaseName).toBe("Clients");
    expect(db.attrs.databaseId).toBeUndefined();
  });

  it("inline gras → marque bold dans le delta", () => {
    const [p] = tree("Texte **important** ici");
    const delta = (p.children[0] as { delta: Array<{ insert: string; attributes?: Record<string, unknown> }> }).delta;
    const bold = delta.find((d) => d.attributes?.bold);
    expect(bold?.insert).toBe("important");
  });

  it("bloc dépliable → details > detailsSummary + detailsContent", () => {
    const [details] = tree(
      "<details>\n<summary>Voir le transcript</summary>\n<div data-type=\"detailsContent\">\n\n## Titre interne\n\n- un\n- deux\n\n</div>\n</details>"
    );
    expect(details.type).toBe("details");
    const [summary, content] = details.children as TreeNode[];
    expect(summary.type).toBe("detailsSummary");
    expect((summary.children[0] as { text: string }).text).toBe("Voir le transcript");
    expect(content.type).toBe("detailsContent");
    expect((content.children as TreeNode[]).map((c) => c.type)).toEqual([
      "heading",
      "bulletList",
    ]);
  });

  it("bloc dépliable vide → detailsContent avec un paragraphe", () => {
    const [details] = tree("<details>\n<summary>Vide</summary>\n<div data-type=\"detailsContent\">\n\n</div>\n</details>");
    const content = (details.children as TreeNode[])[1];
    expect(content.children).toHaveLength(1);
    expect((content.children[0] as TreeNode).type).toBe("paragraph");
  });

  it("paragraphe simple", () => {
    const [p] = tree("Juste un paragraphe.");
    expect(p.type).toBe("paragraph");
  });
});
