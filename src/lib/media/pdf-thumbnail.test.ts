import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDeflate } from "node:zlib";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { renderPdfFirstPage } from "./pdf-thumbnail";

/** PDF de quelques Mo dont une image Flate RVB 30000x30000 se décode en 2,7 Go. */
async function hostilePdf(): Promise<Buffer> {
  const W = 30_000;
  const total = W * W * 3;
  const chunk = Buffer.alloc(1 << 20);
  const parts: Buffer[] = [];
  const z = createDeflate({ level: 9 });
  z.on("data", (c: Buffer) => parts.push(c));
  const ended = new Promise<void>((r) => z.on("end", () => r()));
  for (let n = 0; n < total; n += chunk.length) z.write(chunk.subarray(0, Math.min(chunk.length, total - n)));
  z.end();
  await ended;
  const stream = Buffer.concat(parts);
  const content = "q 200 0 0 200 0 0 cm /Im0 Do Q";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  const out: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  objs.forEach((o, i) => out.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`)));
  out.push(
    Buffer.from(
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${W} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`,
    ),
    stream,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n"),
  );
  return Buffer.concat(out);
}

const fx = (n: string) => readFileSync(path.join(__dirname, "__fixtures__", n));

describe("renderPdfFirstPage", () => {
  it("PDF valide : WebP de 480 px de large et nombre de pages", async () => {
    const r = await renderPdfFirstPage(fx("ok.pdf"));
    expect(r).not.toBeNull();
    expect(r!.pageCount).toBe(3);
    expect(r!.width).toBe(480);
    const meta = await sharp(r!.webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(480);
  }, 30_000);

  it("PDF chiffré, corrompu ou vide : null sans exception", async () => {
    expect(await renderPdfFirstPage(fx("encrypted.pdf"))).toBeNull();
    expect(await renderPdfFirstPage(fx("corrupt.pdf"))).toBeNull();
    expect(await renderPdfFirstPage(Buffer.alloc(0))).toBeNull();
  }, 30_000);

  it("délai dépassé : null", async () => {
    expect(await renderPdfFirstPage(fx("ok.pdf"), { timeoutMs: 1 })).toBeNull();
  }, 30_000);

  it("page 1 géante : null", async () => {
    const d = await PDFDocument.create();
    d.addPage([20_000, 20_000]);
    const buf = Buffer.from(await d.save());
    expect(await renderPdfFirstPage(buf)).toBeNull();
  }, 30_000);

  it("2 000 pages : seule la page 1 est chargée, temps borné", async () => {
    const d = await PDFDocument.create();
    for (let i = 0; i < 2000; i++) d.addPage([200, 200]);
    const buf = Buffer.from(await d.save());
    const t0 = Date.now();
    const r = await renderPdfFirstPage(buf);
    expect(r?.pageCount).toBe(2000);
    expect(Date.now() - t0).toBeLessThan(15_000);
  }, 40_000);

  it("PDF hostile (image Flate 30000x30000) : null, process vivant, mémoire bornée", async () => {
    const buf = await hostilePdf();
    expect(buf.length).toBeLessThan(10 * 1024 * 1024);
    const t0 = Date.now();
    const r = await renderPdfFirstPage(buf, { timeoutMs: 20_000 });
    // Page rendue sans l'image géante (ignorée) ou null : jamais d'exception ni de crash.
    if (r) expect(r.webp.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(21_000);
    expect(process.memoryUsage().rss).toBeLessThan(1.5 * 1024 ** 3);
  }, 60_000);

  it("worker tué à l'échéance : la boucle principale reste réactive", async () => {
    let ticks = 0;
    const iv = setInterval(() => ticks++, 20);
    const r = await renderPdfFirstPage(await hostilePdf(), { timeoutMs: 50 });
    clearInterval(iv);
    expect(r).toBeNull();
    expect(ticks).toBeGreaterThan(0);
  }, 60_000);
});
