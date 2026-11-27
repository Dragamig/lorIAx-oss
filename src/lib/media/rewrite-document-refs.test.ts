import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { rewriteDocumentRefs, rewriteStudioRefs, type LookupResult } from "./rewrite-document-refs";

const ID = "11111111-1111-4111-8111-111111111111";
const ORG = "org-1";

function lookupOf(map: Record<string, LookupResult>) {
  return vi.fn(async (keys: string[]): Promise<Map<string, LookupResult>> => {
    return new Map(keys.map((k) => [k, map[k] ?? { status: "missing" }] as [string, LookupResult]));
  });
}

describe("rewriteStudioRefs", () => {
  it("remplace chaque occurrence et laisse intact un autre domaine", () => {
    const md = `![a](/api/studio/images/${ID}) <img src="/api/studio/images/${ID}"> https://autre.tld/api/studio/images/${ID}`;
    expect(rewriteStudioRefs(md)).toBe(
      `![a](/api/media/${ID}) <img src="/api/media/${ID}"> https://autre.tld/api/studio/images/${ID}`,
    );
  });
  it("laisse intacte une URL sans identifiant valide", () => {
    expect(rewriteStudioRefs("/api/studio/images/abc")).toBe("/api/studio/images/abc");
  });
});

describe("rewriteDocumentRefs", () => {
  it("remplace dans une image et dans un lien", async () => {
    const lookup = lookupOf({ "a/b.png": { status: "found", id: ID } });
    const md = "![x](/api/attachments/a/b.png) et [f](/api/attachments/a/b.png)";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(`![x](/api/media/${ID}) et [f](/api/media/${ID})`);
    expect(r.rewritten).toBe(2);
    expect(r.skipped).toBe(0);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("laisse inchangées les clés introuvables ou ambiguës", async () => {
    const lookup = lookupOf({ amb: { status: "ambiguous" } });
    const md = "![x](/api/attachments/nope.png) ![y](/api/attachments/amb)";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(md);
    expect(r.rewritten).toBe(0);
    expect(r.skipped).toBe(2);
  });

  it("ne touche ni bloc de code ni code en ligne", async () => {
    const lookup = lookupOf({ k: { status: "found", id: ID } });
    const md = "```\n/api/attachments/k\n```\n\n`/api/attachments/k`\n\n~~~\n/api/attachments/k\n~~~\n\n/api/attachments/k";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(md.replace(/\/api\/attachments\/k$/, `/api/media/${ID}`));
    expect(r.rewritten).toBe(1);
  });

  it("protège toutes les lignes d'un bloc clôturé de plusieurs lignes", async () => {
    const lookup = lookupOf({ k: { status: "found", id: ID } });
    const md = "```\nligne 1\n/api/attachments/k\nligne 3 /api/attachments/k\n```\n\n/api/attachments/k";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(md.replace(/\n\n\/api\/attachments\/k$/, `\n\n/api/media/${ID}`));
    expect(r.rewritten).toBe(1);
  });

  it("bloc non clôturé : protégé jusqu'à la fin du texte", async () => {
    const lookup = lookupOf({ k: { status: "found", id: ID } });
    const md = "~~~\na\n/api/attachments/k\nb\n/api/attachments/k";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(md);
    expect(r.rewritten).toBe(0);
  });

  it("code en ligne protégé, texte voisin réécrit", async () => {
    const lookup = lookupOf({ k: { status: "found", id: ID } });
    const md = "avant `![](/api/attachments/k)` puis ![](/api/attachments/k)";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(`avant \`![](/api/attachments/k)\` puis ![](/api/media/${ID})`);
  });

  it("une seule résolution groupée pour toutes les clés", async () => {
    const lookup = lookupOf({ a: { status: "found", id: ID }, b: { status: "found", id: ID } });
    await rewriteDocumentRefs("![](/api/attachments/a) ![](/api/attachments/b) ![](/api/attachments/a)", ORG, lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect([...lookup.mock.calls[0][0]].sort()).toEqual(["a", "b"]);
  });

  it("texte sans référence : même chaîne, aucune lecture", async () => {
    const lookup = lookupOf({});
    const md = "# Titre\n![d](data:image/png;base64,AAAA) [e](https://x.com/api/attachments/k)";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(md);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("ne réécrit pas une URL absolue d'un autre domaine", async () => {
    const lookup = lookupOf({ k: { status: "found", id: ID } });
    const md = "![e](https://autre.example/api/attachments/k)";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(md);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("clé encodée : décodée pour la recherche", async () => {
    const lookup = lookupOf({ "dir/mon fichier.png": { status: "found", id: ID } });
    const r = await rewriteDocumentRefs("![](/api/attachments/dir/mon%20fichier.png)", ORG, lookup);
    expect(r.markdown).toBe(`![](/api/media/${ID})`);
  });

  it("est idempotent", async () => {
    const lookup = lookupOf({ k: { status: "found", id: ID } });
    const first = await rewriteDocumentRefs("![](/api/attachments/k)", ORG, lookup);
    const second = await rewriteDocumentRefs(first.markdown, ORG, lookup);
    expect(second.markdown).toBe(first.markdown);
    expect(second.rewritten).toBe(0);
  });

  it("une résolution en échec laisse la référence intacte", async () => {
    const lookup = vi.fn(async (_keys: string[]): Promise<Map<string, LookupResult>> => {
      throw new Error("db down");
    });
    const md = "![](/api/attachments/k)";
    const r = await rewriteDocumentRefs(md, ORG, lookup);
    expect(r.markdown).toBe(md);
    expect(r.skipped).toBe(1);
  });
});

describe("garde : la réécriture n'est appelée que par la route de sauvegarde non collaborative", () => {
  const SRC = path.resolve(__dirname, "../..");
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("seuls la route PATCH des documents et le résolveur (type seul) l importent, jamais le serveur collaboratif", () => {
    const importers = walk(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((rel) => /rewrite-document-refs/.test(readFileSync(path.join(SRC, rel), "utf8")))
      .filter((rel) => rel !== "lib/media/rewrite-document-refs.ts");
    expect(importers.sort()).toEqual([
      "app/api/documents/[id]/route.ts",
      "lib/collab/rewrite-media-refs.ts", // script hors ligne : réutilise l'expression partagée, jamais le serveur collaboratif
      "lib/media/attachment-key-lookup.ts",
    ]);
  });
});
