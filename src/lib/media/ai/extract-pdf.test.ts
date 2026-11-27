import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText } from "./extract-pdf";
import { MAX_PDF_PAGES } from "./limits";

const fx = (n: string) => readFileSync(path.join(__dirname, "../__fixtures__", n));

async function makePdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedStandardFont(StandardFonts.Helvetica);
  for (const t of pages) {
    const p = doc.addPage([400, 400]);
    if (t) p.drawText(t, { x: 20, y: 300, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

describe("extractPdfText", () => {
  it("rend le texte et le nombre de pages", async () => {
    const r = await extractPdfText(await makePdf(["Bonjour monde"]));
    expect(r?.text).toContain("Bonjour monde");
    expect(r?.pages).toBe(1);
    expect(r?.truncated).toBe(false);
  });

  it("concatène les pages avec un séparateur", async () => {
    const r = await extractPdfText(await makePdf(["premiere", "seconde"]));
    expect(r?.text).toBe("premiere\n\nseconde");
    expect(r?.pages).toBe(2);
  });

  it("rend null pour un PDF corrompu, chiffré ou tronqué", async () => {
    expect(await extractPdfText(fx("corrupt.pdf"))).toBeNull();
    expect(await extractPdfText(fx("encrypted.pdf"))).toBeNull();
    const ok = await makePdf(["abc"]);
    expect(await extractPdfText(ok.subarray(0, 40))).toBeNull();
  });

  it("s'arrête à MAX_PDF_PAGES", async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 100 }, (_, i) => `p${i + 1}`);
    const r = await extractPdfText(await makePdf(pages), { timeoutMs: 60_000 });
    expect(r?.truncated).toBe(true);
    expect(r?.pages).toBe(MAX_PDF_PAGES + 100);
    expect(r?.text).toContain(`p${MAX_PDF_PAGES}`);
    expect(r?.text).not.toContain(`p${MAX_PDF_PAGES + 1}\n`);
  }, 90_000);

  it("coupe le texte au plafond de caractères", async () => {
    const r = await extractPdfText(await makePdf(["abcdefghij", "klmnopqrst"]), { maxChars: 12 });
    expect(r?.truncated).toBe(true);
    expect(r?.text.length).toBe(12);
  });

  it("rend null à l'échéance et termine le worker", async () => {
    const r = await extractPdfText(await makePdf(["abc"]), { timeoutMs: 1 });
    expect(r).toBeNull();
  });

  it("PDF sans couche texte : texte vide", async () => {
    const r = await extractPdfText(await makePdf([""]));
    expect(r).toEqual({ text: "", pages: 1, truncated: false });
  });

  it("ne touche ni au disque en écriture ni au réseau", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await extractPdfText(await makePdf(["x"]));
    expect(r?.text).toBe("x");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
