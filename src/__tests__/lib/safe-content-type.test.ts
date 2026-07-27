import { describe, it, expect } from "vitest";
import {
  extensionOf,
  resolveSafeStorageType,
  resolveDownloadedStorageType,
  presentationOverrides,
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

/** SVG precede d'une declaration XML : file-type le detecte, en `xml`. */
const XML_DECLARED_SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  "utf-8"
);

/** Conteneur OLE2, ce que file-type v21 detecte pour tout Office historique. */
const CFB_HEADER = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(1600),
]);

/** Conteneur Ogg portant de l'Opus : file-type le detecte en `opus`, pas en `ogg`. */
function oggBuffer(codec: string): Buffer {
  const b = Buffer.alloc(64);
  b.write("OggS", 0, "ascii");
  b.write(codec, 28, "ascii");
  return b;
}

const OGG_OPUS = oggBuffer("OpusHead");

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

  it("accepte les formats media des mobiles", () => {
    for (const ext of ["heic", "heif", "mov", "m4a", "tiff", "avif"]) {
      expect(ALLOWED_UPLOAD_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it("accepte un Office historique, detecte comme conteneur CFB", async () => {
    const result = await resolveSafeStorageType("doc", CFB_HEADER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("application/msword");
  });

  it("refuse un conteneur CFB annonce sous une extension etrangere a la famille", async () => {
    const result = await resolveSafeStorageType("png", CFB_HEADER);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("mismatch");
  });

  it("accepte un .ogg dont le codec fait sortir file-type en .opus", async () => {
    // Sans normalisation, ce fichier legitime etait refuse en 400 avec
    // « extension .ogg mais contenu detecte comme .opus ».
    const result = await resolveSafeStorageType("ogg", OGG_OPUS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("audio/ogg; codecs=opus");
  });
});

describe("resolveDownloadedStorageType", () => {
  it("type un fichier tiers par ses octets, sans se fier au nom", async () => {
    const result = await resolveDownloadedStorageType("Photo du chantier", PNG_HEADER);

    expect(result.ext).toBe("png");
    expect(result.contentType).toBe("image/png");
    expect(result.neutralizedReason).toBeUndefined();
  });

  it("ne perd jamais un fichier non typable : il est stocke inerte", async () => {
    const result = await resolveDownloadedStorageType("Piece jointe", SVG_BODY);

    expect(result.neutralizedReason).toBeDefined();
    expect(result.ext).toBe("bin");
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("neutralise un SVG servi par un tiers meme quand le nom l'annonce", async () => {
    const result = await resolveDownloadedStorageType("logo.svg", SVG_BODY);

    expect(result.neutralizedReason).toBeDefined();
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("neutralise un document actif positivement detecte", async () => {
    const result = await resolveDownloadedStorageType("schema.svg", XML_DECLARED_SVG);

    expect(result.neutralizedReason).toBe("active");
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("conserve un media identifie par ses octets, meme hors liste de televersement", async () => {
    // Un memo vocal Ogg/Opus : file-type l'identifie avec certitude, aucune raison
    // de le degrader en binaire opaque illisible.
    const result = await resolveDownloadedStorageType("Memo vocal", OGG_OPUS);

    expect(result.neutralizedReason).toBeUndefined();
    expect(result.ext).toBe("opus");
    expect(result.contentType).toBe("audio/ogg; codecs=opus");
    expect(result.contentDisposition).toBeUndefined();
  });

  it("nomme un Office historique a l'aide du nom quand les octets ne disent que CFB", async () => {
    const result = await resolveDownloadedStorageType("compte-rendu.doc", CFB_HEADER);

    expect(result.ext).toBe("doc");
    expect(result.contentType).toBe("application/msword");
    expect(result.neutralizedReason).toBeUndefined();
  });

  it("conserve un type textuel inerte quand les octets ne disent rien", async () => {
    const result = await resolveDownloadedStorageType(
      "notes.txt",
      Buffer.from("bonjour", "utf-8")
    );

    expect(result.ext).toBe("txt");
    expect(result.contentType).toBe("text/plain; charset=utf-8");
  });
});

describe("presentationOverrides", () => {
  it("neutralise a la restitution un SVG stocke avant le durcissement", () => {
    const result = presentationOverrides("image/svg+xml");

    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("neutralise aussi un text/html d'epoque", () => {
    const result = presentationOverrides("text/html");

    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("laisse une image bitmap s'afficher en ligne", () => {
    const result = presentationOverrides("image/png");

    expect(result.contentType).toBe("image/png");
    expect(result.contentDisposition).toBe("inline");
  });

  it("ignore les parametres du type stocke pour decider", () => {
    const result = presentationOverrides("text/plain; charset=utf-8");

    expect(result.contentDisposition).toBe("inline");
  });

  it("laisse jouer les conteneurs media quel que soit le codec", () => {
    for (const mime of [
      "video/x-matroska",
      "video/x-msvideo",
      "video/mpeg",
      "video/3gpp",
      "audio/amr",
      "audio/ogg; codecs=opus",
    ]) {
      expect(presentationOverrides(mime).contentDisposition).toBe("inline");
    }
  });

  it("ne se laisse pas avoir par un type image fantaisiste portant du xml", () => {
    expect(presentationOverrides("image/svg-xml").contentDisposition).toBe("attachment");
  });

  it("refuse un type a virgule, que le navigateur redecouperait en text/html", () => {
    // Valeur enregistrable avant le durcissement : l'ancienne route reprenait
    // `file.type` tel quel, et la virgule survit au constructeur `File`. Posee en
    // en-tete, le navigateur retient le dernier type valide, donc `text/html`.
    const result = presentationOverrides("image/png,text/html");

    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe("attachment");
  });

  it("ne restitue jamais la chaine stockee telle quelle", () => {
    // Parametre inconnu et espaces parasites : ce qui sort est recompose a partir
    // des morceaux valides, jamais repris de l'entree.
    const result = presentationOverrides("  IMAGE/PNG ; boundary=zzz ");

    expect(result.contentType).toBe("image/png");
    expect(result.contentDisposition).toBe("inline");
  });

  it("conserve charset et codecs, les seuls parametres qui changent le rendu", () => {
    expect(presentationOverrides("text/plain; charset=utf-8").contentType).toBe(
      "text/plain; charset=utf-8"
    );
    expect(presentationOverrides("audio/ogg; codecs=opus").contentType).toBe(
      "audio/ogg; codecs=opus"
    );
  });

  it("refuse un charset porteur de guillemet ou de virgule", () => {
    expect(presentationOverrides('text/plain; charset="utf-8,x"').contentType).toBe(
      "text/plain"
    );
  });

  it("refuse une chaine qui n'est pas un type sur sous-type", () => {
    for (const value of ["", "image", "image/", "/png", "image/png/extra", "  "]) {
      expect(presentationOverrides(value).contentDisposition).toBe("attachment");
    }
  });
});
