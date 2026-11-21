import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { buildMeetingNotesContent } from "./meeting-notes";
import { templateContentToYjsState } from "@/lib/editor/template-to-yjs";

/** Texte brut de tous les nœuds du fragment Yjs décodé. */
function flatten(node: Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) return node.toString();
  return (node as Y.XmlElement)
    .toArray()
    .map((c) => flatten(c as Y.XmlElement | Y.XmlText))
    .join(" ");
}

function types(el: Y.XmlElement | Y.XmlFragment): string[] {
  return el.toArray().map((c) => (c as Y.XmlElement).nodeName as string);
}

describe("meeting-notes — état Yjs initial du compte rendu", () => {
  const markdown = buildMeetingNotesContent({
    docTitle: "Compte-rendu : Point produit (lundi 17 août 2026)",
    summary: "## Décisions\n\n- Livrer la visio\n- Corriger le compte rendu vide",
    transcript: "`0:00` **Alice** Bonjour tout le monde.\n\n`0:12` **Bob** On commence.",
  });

  it("produit un état Yjs non vide", () => {
    const state = templateContentToYjsState({ markdown });
    expect(state).not.toBeNull();
    expect(state!.length).toBeGreaterThan(0);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, state!);
    const frag = doc.getXmlFragment("default");
    expect(frag.length).toBeGreaterThan(0);
    expect(types(frag)).toContain("details");
  });

  it("contient le résumé et le transcript", () => {
    const state = templateContentToYjsState({ markdown })!;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const text = doc
      .getXmlFragment("default")
      .toArray()
      .map((c) => flatten(c as Y.XmlElement))
      .join(" ");

    expect(text).toContain("Compte-rendu : Point produit");
    expect(text).toContain("Livrer la visio");
    expect(text).toContain("Bonjour tout le monde.");
    expect(text).toContain("On commence.");
    // Aucune balise HTML littérale ne doit subsister
    expect(text).not.toContain("<details>");
    expect(text).not.toContain("detailsContent");
  });

  it("range le transcript dans un bloc dépliable", () => {
    const state = templateContentToYjsState({ markdown })!;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const details = doc
      .getXmlFragment("default")
      .toArray()
      .find((c) => (c as Y.XmlElement).nodeName === "details") as Y.XmlElement;

    expect(details).toBeDefined();
    expect(types(details)).toEqual(["detailsSummary", "detailsContent"]);
    expect(flatten(details)).toContain("Bonjour tout le monde.");
  });
});
