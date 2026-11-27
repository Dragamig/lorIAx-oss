import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { extractOfficeText } from "./extract-office";
import { extractSheetText } from "./extract-sheet";
import { extractExifText } from "./extract-exif";
import { extractText, extractableKind } from "./extract";
import { MAX_UNZIPPED_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES } from "./limits";

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const z = new JSZip();
  for (const [n, c] of Object.entries(files)) z.file(n, c);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (paras: string[]) =>
  `<?xml version="1.0"?><w:document ${W}><w:body>${paras
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
const slide = (t: string) =>
  `<p:sld xmlns:p="p" xmlns:a="a"><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sld>`;

describe("extractOfficeText", () => {
  it("docx : paragraphes dans l'ordre, sans balises", async () => {
    const buf = await zipOf({ "word/document.xml": docx(["Premier", "Second &amp; fin"]) });
    const r = await extractOfficeText(buf, "docx");
    expect(r?.text).toBe("Premier\nSecond & fin");
  });

  it("pptx : une diapositive par bloc, ordre numérique", async () => {
    const files: Record<string, string> = {};
    for (const i of [1, 2, 10]) files[`ppt/slides/slide${i}.xml`] = slide(`S${i}`);
    const r = await extractOfficeText(await zipOf(files), "pptx");
    expect(r?.text).toBe("S1\n\nS2\n\nS10");
  });

  it("odt et odp : content.xml", async () => {
    const xml = `<office:document-content xmlns:office="o" xmlns:text="t"><text:p>Alpha</text:p><text:h>Beta<text:s/>gamma</text:h></office:document-content>`;
    for (const f of ["odt", "odp"] as const) {
      expect((await extractOfficeText(await zipOf({ "content.xml": xml }), f))?.text).toBe("Alpha\nBeta gamma");
    }
  });

  it("zip bomb : entrée unique trop grosse une fois décompressée", async () => {
    const big = Buffer.alloc(MAX_ZIP_ENTRY_BYTES * 3, 0x61);
    const buf = await zipOf({ "word/document.xml": big });
    expect(buf.length).toBeLessThan(1_000_000);
    const t0 = Date.now();
    expect(await extractOfficeText(buf, "docx")).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 30_000);

  it("zip bomb : cumul décompressé au-delà de MAX_UNZIPPED_BYTES", async () => {
    const chunk = Buffer.alloc(MAX_ZIP_ENTRY_BYTES - 1024, 0x20);
    const n = Math.ceil(MAX_UNZIPPED_BYTES / chunk.length) + 1;
    const files: Record<string, Buffer> = {};
    for (let i = 1; i <= n; i++) files[`ppt/slides/slide${i}.xml`] = chunk;
    expect(await extractOfficeText(await zipOf(files), "pptx")).toBeNull();
  }, 60_000);

  it("trop d'entrées : null", async () => {
    const files: Record<string, string> = { "word/document.xml": docx(["x"]) };
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`f${i}.txt`] = "";
    expect(await extractOfficeText(await zipOf(files), "docx")).toBeNull();
  });

  it("entrée à chemin ../ ignorée", async () => {
    const z = new JSZip();
    z.file("../word/document.xml", docx(["evil"]), { createFolders: false });
    const buf = await z.generateAsync({ type: "nodebuffer" });
    expect(await extractOfficeText(buf, "docx")).toBeNull();
  });

  it("entités externes et DTD jamais résolues", async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document ${W}><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`;
    const r = await extractOfficeText(await zipOf({ "word/document.xml": evil }), "docx");
    expect(r === null || !/root:/.test(r.text)).toBe(true);
  });

  it("archive corrompue : null", async () => {
    expect(await extractOfficeText(Buffer.from("pas un zip"), "docx")).toBeNull();
  });
});

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
async function xlsx(sheetCount = 1, rowsPerSheet?: string): Promise<Buffer> {
  const files: Record<string, string> = {
    "xl/workbook.xml": `<workbook ${S} xmlns:r="r"><sheets>${Array.from(
      { length: sheetCount },
      (_, i) => `<sheet name="Feuille${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    ).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="r">${Array.from(
      { length: sheetCount },
      (_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`,
    ).join("")}</Relationships>`,
    "xl/sharedStrings.xml": `<sst ${S}><si><t>Nom</t></si><si><t>Zoé</t></si></sst>`,
  };
  for (let i = 1; i <= sheetCount; i++) {
    files[`xl/worksheets/sheet${i}.xml`] =
      `<worksheet ${S}><sheetData>${
        rowsPerSheet ??
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>B1*2</f><v>84</v></c></row>`
      }</sheetData></worksheet>`;
  }
  return zipOf(files);
}

describe("extractSheetText", () => {
  it("xlsx : feuilles nommées, lignes tabulées, formule par sa valeur", async () => {
    const r = await extractSheetText(await xlsx(), "xlsx");
    expect(r?.text).toBe("# Feuille1\nNom\t42\nZoé\t84");
  });

  it("xlsx : arrêt à 10 feuilles", async () => {
    const r = await extractSheetText(await xlsx(12), "xlsx");
    expect(r?.truncated).toBe(true);
    expect(r?.text).toContain("# Feuille10");
    expect(r?.text).not.toContain("# Feuille11");
  });

  it("xlsx : arrêt à 20 000 cellules", async () => {
    const rows = Array.from({ length: 3000 }, () => `<row>${"<c><v>1</v></c>".repeat(10)}</row>`).join("");
    const r = await extractSheetText(await xlsx(1, rows), "xlsx");
    expect(r?.truncated).toBe(true);
    expect(r!.text.split("\n").length).toBeLessThan(2100);
  });

  it("xlsx corrompu : null", async () => {
    expect(await extractSheetText(Buffer.from("zzz"), "xlsx")).toBeNull();
    expect(await extractSheetText(await zipOf({ "a.txt": "x" }), "xlsx")).toBeNull();
  });

  it("csv : UTF-8 avec BOM et fins de ligne mixtes", async () => {
    const csv = Buffer.from("﻿nom,ville\r\nZoé,Lyon\nAmi,\"Aix, 13\"\r\n");
    const r = await extractSheetText(csv, "csv");
    expect(r?.text).toBe("nom\tville\nZoé\tLyon\nAmi\tAix, 13");
  });

  it("csv : arrêt à 20 000 cellules", async () => {
    const csv = Buffer.from(Array.from({ length: 5000 }, () => "a,b,c,d,e").join("\n"));
    const r = await extractSheetText(csv, "csv");
    expect(r?.truncated).toBe(true);
  });
});

async function jpeg(withGps = true): Promise<Buffer> {
  const img = sharp({ create: { width: 20, height: 20, channels: 3, background: "#888" } }).jpeg();
  const exif = {
    IFD0: { Make: "ACME", Model: "Cam1", Copyright: "(c) Moi", Artist: "Alice", ImageDescription: "Un chat roux" },
    IFD2: { DateTimeOriginal: "2024:05:06 07:08:09" },
    ...(withGps
      ? { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 30/1", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 7/1", GPSAltitude: "35/1" } }
      : {}),
  };
  return img.withExif(exif).toBuffer();
}

describe("extractExifText", () => {
  it("appareil, date, description, auteur, copyright, sans GPS", async () => {
    const t = (await extractExifText(await jpeg(true))) as string;
    expect(t).toContain("Appareil : ACME Cam1");
    expect(t).toContain("Date de prise de vue : 2024-05-06 07:08:09");
    expect(t).toContain("Description : Un chat roux");
    expect(t).toContain("Auteur : Alice");
    expect(t).toContain("Copyright : (c) Moi");
    expect(t).not.toMatch(/GPS|latitude|longitude|altitude|48\.8|2\.35|35/i);
  });

  it("mots-clés XMP", async () => {
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag><rdf:li>chat</rdf:li><rdf:li>jardin</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const b = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .jpeg()
      .withXmp(xmp)
      .toBuffer();
    const t = await extractExifText(b);
    expect(t).toContain("Mots-clés : chat, jardin");
  });

  it("JPEG sans EXIF : null", async () => {
    const b = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect(await extractExifText(b)).toBeNull();
  });
});

describe("extractableKind", () => {
  it("décide l'extracteur", () => {
    expect(extractableKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(extractableKind("application/octet-stream", "a.docx")).toBe("office");
    expect(extractableKind("application/octet-stream", "a.xlsx")).toBe("sheet");
    expect(extractableKind("text/csv", "a.csv")).toBe("sheet");
    expect(extractableKind("text/plain", "a.txt")).toBe("text");
    expect(extractableKind("image/jpeg", "a.jpg")).toBe("exif");
    expect(extractableKind("image/webp", "a.webp")).toBe("exif");
    expect(extractableKind("image/png", "a.png")).toBeNull();
    expect(extractableKind("video/mp4", "a.mp4")).toBe("transcript");
    expect(extractableKind("audio/mpeg", "a.mp3")).toBe("transcript");
    expect(extractableKind("application/zip", "a.zip")).toBeNull();
    expect(extractableKind("application/msword", "a.doc")).toBeNull();
    expect(extractableKind("application/octet-stream", "a.doc")).toBeNull();
  });
});

describe("extractText", () => {
  it("texte brut, docx, vide, trop gros, non supporté", async () => {
    const t = await extractText({ buffer: Buffer.from("a\r\n\r\n\r\n\r\nb"), mimeType: "text/plain", filename: "a.txt" });
    expect(t).toEqual({ ok: true, text: "a\n\nb", source: "text", truncated: false });
    const d = await extractText({
      buffer: await zipOf({ "word/document.xml": docx(["Salut"]) }),
      mimeType: "application/octet-stream",
      filename: "x.docx",
    });
    expect(d).toMatchObject({ ok: true, source: "office", text: "Salut" });
    expect(await extractText({ buffer: Buffer.from("  "), mimeType: "text/plain", filename: "a.txt" })).toEqual({ ok: false, reason: "empty" });
    expect(await extractText({ buffer: Buffer.alloc(52_428_801), mimeType: "text/plain", filename: "a.txt" })).toEqual({ ok: false, reason: "too_large" });
    expect(await extractText({ buffer: Buffer.from("x"), mimeType: "image/png", filename: "a.png" })).toEqual({ ok: false, reason: "unsupported" });
    expect(await extractText({ buffer: Buffer.from("x"), mimeType: "application/pdf", filename: "a.pdf" })).toEqual({ ok: false, reason: "error" });
  });

  it("EXIF sans métadonnées : empty", async () => {
    const b = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect(await extractText({ buffer: b, mimeType: "image/jpeg", filename: "a.jpg" })).toEqual({ ok: false, reason: "empty" });
  });
});
