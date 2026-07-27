import { describe, it, expect } from "vitest";
import {
  extensionOf,
  resolveSafeStorageType,
  ALLOWED_UPLOAD_EXTENSIONS,
} from "@/lib/storage/safe-content-type";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

const SVG_BODY = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  "utf-8"
);

describe("extensionOf", () => {
  it("normalise en minuscules", () => {
    expect(extensionOf("Rapport.PDF")).toBe("pdf");
  });

  it("retourne une chaine vide sans extension", () => {
    expect(extensionOf("archive")).toBe("");
  });

  it("prend le dernier segment", () => {
    expect(extensionOf("photo.tar.gz")).toBe("gz");
  });
});

describe("resolveSafeStorageType", () => {
  it("neutralise le SVG au lieu de le rendre executable", async () => {
    const result = await resolveSafeStorageType("svg", SVG_BODY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("neutralise aussi le XML, executable par feuille XSLT", async () => {
    const result = await resolveSafeStorageType("xml", Buffer.from("<a/>", "utf-8"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("impose un type sur au texte, sans jamais rendre du HTML", async () => {
    const result = await resolveSafeStorageType(
      "txt",
      Buffer.from("<script>alert(1)</script>", "utf-8")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("text/plain; charset=utf-8");
  });

  it("deduit le type binaire des octets reels", async () => {
    const result = await resolveSafeStorageType("png", PNG_HEADER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("image/png");
    expect(result.contentDisposition).toBeUndefined();
  });

  it("refuse un SVG deguise en PNG : aucun octet magique reconnu", async () => {
    const result = await resolveSafeStorageType("png", SVG_BODY);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unrecognized");
  });

  it("refuse une extension incoherente avec le contenu", async () => {
    const result = await resolveSafeStorageType("gif", PNG_HEADER);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("mismatch");
  });

  it("refuse une extension hors liste blanche", async () => {
    const result = await resolveSafeStorageType("html", Buffer.from("<h1>x</h1>"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("extension");
  });

  it("refuse un nom de fichier sans extension", async () => {
    const result = await resolveSafeStorageType(extensionOf("facture"), PNG_HEADER);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("extension");
  });

  it("ne laisse pas svg sortir de la liste blanche des extensions acceptees", () => {
    // Le SVG reste un format accepte par le produit : c'est son stockage qui est
    // neutralise, pas son televersement.
    expect(ALLOWED_UPLOAD_EXTENSIONS.has("svg")).toBe(true);
    expect(ALLOWED_UPLOAD_EXTENSIONS.has("html")).toBe(false);
  });
});
