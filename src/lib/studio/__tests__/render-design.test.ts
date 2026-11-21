// @vitest-environment node
//
// Le rendu réel s'appuie sur le binaire natif `canvas` (Cairo/Pango) : on force
// l'environnement Node (pas jsdom) pour que fabric/node fonctionne.
import { describe, it, expect, vi } from "vitest";
import type { DesignDocument, DesignPage } from "@/components/editor/extensions/design-constants";

// Mock anti-SSRF : `assertPublicHostname` throw pour les hôtes privés/internes
// (métadonnées cloud, loopback, RFC1918), resolve pour un hôte public.
vi.mock("@/lib/security/url-validator-server", () => ({
  assertPublicHostname: vi.fn(async (url: URL) => {
    const h = url.hostname;
    if (
      h === "169.254.169.254" ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      h.startsWith("10.") ||
      h.startsWith("192.168.")
    ) {
      throw new Error("URL résolue vers une adresse privée");
    }
  }),
}));

import { renderDesign, pageDimensions, sanitizeDesignForRender } from "../render-design";
import { assertPublicHostname } from "@/lib/security/url-validator-server";

function makeDoc(overrides: Partial<DesignPage> = {}): DesignDocument {
  const page: DesignPage = {
    id: "p1",
    name: "Page 1",
    format: "free",
    bgColor: "#ffffff",
    customWidth: 240,
    customHeight: 160,
    thumbnail: null,
    json: {
      version: "7.0.0",
      objects: [
        {
          type: "i-text",
          text: "Bonjour",
          left: 20,
          top: 20,
          fontSize: 40,
          fill: "#000000",
        },
      ],
    },
    ...overrides,
  };
  return { version: 2, title: "Test", pages: [page] };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]; // \x89 P N G

describe("pageDimensions (util pur)", () => {
  it("utilise customWidth/customHeight pour le format free", () => {
    expect(pageDimensions(makeDoc().pages[0])).toEqual({ width: 240, height: 160 });
  });

  it("retombe sur la table des formats pour un format nommé", () => {
    const page: DesignPage = { ...makeDoc().pages[0], format: "a4-portrait", customWidth: undefined, customHeight: undefined };
    expect(pageDimensions(page)).toEqual({ width: 595, height: 842 });
  });

  it("repli sur a4-portrait pour un format inconnu (content non validé, pas de crash)", () => {
    // Régression : un design ancien/malformé avec un format hors table renvoyait
    // undefined → crash `.width` au rendu (trouvé par l'e2e réel).
    const page = { ...makeDoc().pages[0], format: "a4", customWidth: undefined, customHeight: undefined } as unknown as DesignPage;
    expect(pageDimensions(page)).toEqual({ width: 595, height: 842 });
  });
});

describe("renderDesign", () => {
  it("rend un PNG valide (signature + contentType/ext)", async () => {
    const result = await renderDesign(makeDoc(), { format: "png" });
    expect(result.contentType).toBe("image/png");
    expect(result.ext).toBe("png");
    expect(result.buffer.length).toBeGreaterThan(0);
    expect([...result.buffer.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
  });

  it("PNG par défaut quand format non précisé", async () => {
    const result = await renderDesign(makeDoc());
    expect(result.contentType).toBe("image/png");
    expect([...result.buffer.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
  });

  it("rend un PDF multi-pages (%PDF)", async () => {
    const doc = makeDoc();
    doc.pages.push({ ...doc.pages[0], id: "p2", name: "Page 2" });
    const result = await renderDesign(doc, { format: "pdf" });
    expect(result.contentType).toBe("application/pdf");
    expect(result.ext).toBe("pdf");
    expect(result.buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("rend une page vide (json null) sans throw", async () => {
    const result = await renderDesign(makeDoc({ json: null }), { format: "png" });
    expect([...result.buffer.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
  });

  it("rend malgré une image à src privée (SSRF neutralisée)", async () => {
    // Un objet image pointant vers les métadonnées cloud ne doit PAS casser le
    // rendu ni déclencher de fetch : la src est neutralisée, le rendu réussit.
    const doc = makeDoc({
      json: {
        version: "7.0.0",
        objects: [
          { type: "image", src: "http://169.254.169.254/latest/meta-data/", left: 0, top: 0 },
        ],
      },
    });
    const result = await renderDesign(doc, { format: "png" });
    expect(result.contentType).toBe("image/png");
    expect([...result.buffer.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
    expect(assertPublicHostname).toHaveBeenCalled();
  });
});

describe("sanitizeDesignForRender (anti-SSRF)", () => {
  function docWithImage(src: string): DesignDocument {
    return {
      version: 2,
      title: "T",
      pages: [
        {
          id: "p1",
          name: "P1",
          format: "free",
          bgColor: "#fff",
          customWidth: 100,
          customHeight: 100,
          thumbnail: null,
          json: { version: "7.0.0", objects: [{ type: "image", src }] },
        },
      ],
    };
  }

  function firstObjSrc(design: DesignDocument): unknown {
    const json = design.pages[0].json as { objects: { src?: unknown }[] };
    return json.objects[0].src;
  }

  it("neutralise une src privée (169.254.169.254)", async () => {
    const out = await sanitizeDesignForRender(docWithImage("http://169.254.169.254/x"));
    expect(firstObjSrc(out)).toBe("");
  });

  it("neutralise une src loopback (localhost)", async () => {
    const out = await sanitizeDesignForRender(docWithImage("http://localhost/x"));
    expect(firstObjSrc(out)).toBe("");
  });

  it("conserve une data: URI (embarquée)", async () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    const out = await sanitizeDesignForRender(docWithImage(dataUri));
    expect(firstObjSrc(out)).toBe(dataUri);
  });

  it("conserve une URL publique validée", async () => {
    const pub = "https://cdn.example.com/logo.png";
    const out = await sanitizeDesignForRender(docWithImage(pub));
    expect(firstObjSrc(out)).toBe(pub);
  });

  it("neutralise une src relative / protocole non http (pas de fetch possible)", async () => {
    const out = await sanitizeDesignForRender(docWithImage("file:///etc/passwd"));
    expect(firstObjSrc(out)).toBe("");
    const rel = await sanitizeDesignForRender(docWithImage("/assets/logo.png"));
    expect(firstObjSrc(rel)).toBe("");
  });

  it("ne mute pas le document source (clone défensif)", async () => {
    const src = "http://169.254.169.254/x";
    const doc = docWithImage(src);
    await sanitizeDesignForRender(doc);
    expect(firstObjSrc(doc)).toBe(src);
  });

  it("neutralise une src imbriquée dans un groupe", async () => {
    const doc: DesignDocument = {
      version: 2,
      title: "T",
      pages: [
        {
          id: "p1",
          name: "P1",
          format: "free",
          bgColor: "#fff",
          customWidth: 100,
          customHeight: 100,
          thumbnail: null,
          json: {
            version: "7.0.0",
            objects: [
              { type: "group", objects: [{ type: "image", src: "http://10.0.0.5/x" }] },
            ],
          },
        },
      ],
    };
    const out = await sanitizeDesignForRender(doc);
    const json = out.pages[0].json as { objects: { objects?: { src?: unknown }[] }[] };
    expect(json.objects[0].objects?.[0].src).toBe("");
  });
});
