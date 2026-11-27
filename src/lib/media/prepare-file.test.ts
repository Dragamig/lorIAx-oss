import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareMediaFile } from "./prepare-file";

describe("prepareMediaFile", () => {
  it("PNG valide : image, dimensions, miniature, empreinte", async () => {
    const buffer = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const r = await prepareMediaFile(
      { name: "a.png", size: buffer.length, type: "image/png" },
      buffer,
      "default",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("image");
    expect(r.width).toBe(40);
    expect(r.height).toBe(20);
    expect(r.thumbnail).not.toBeNull();
    expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("exécutable refusé en 415", async () => {
    const buffer = Buffer.from("contenu sans signature reconnue");
    const r = await prepareMediaFile(
      { name: "a.png", size: buffer.length, type: "image/png" },
      buffer,
      "default",
    );
    expect(r).toMatchObject({ ok: false, status: 415 });
  });

  it("image illisible par sharp : acceptée sans miniature", async () => {
    // PNG réel tronqué : signature reconnue, décodage impossible
    const full = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#00ff00" },
    })
      .png()
      .toBuffer();
    const buffer = full.subarray(0, 40);
    const r = await prepareMediaFile(
      { name: "b.png", size: buffer.length, type: "image/png" },
      buffer,
      "default",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.thumbnail).toBeNull();
  });
  const fx = (n: string) => readFileSync(path.join(__dirname, "__fixtures__", n));

  it("PDF valide : miniature WebP et nombre de pages", async () => {
    const buffer = fx("ok.pdf");
    const r = await prepareMediaFile(
      { name: "a.pdf", size: buffer.length, type: "application/pdf" },
      buffer,
      "default",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("pdf");
    expect(r.thumbnail).not.toBeNull();
    expect(r.pageCount).toBe(3);
  });

  it("PDF chiffré : accepté sans miniature ni nombre de pages", async () => {
    const buffer = fx("encrypted.pdf");
    const r = await prepareMediaFile(
      { name: "e.pdf", size: buffer.length, type: "application/pdf" },
      buffer,
      "default",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.thumbnail).toBeNull();
    expect(r.pageCount).toBeNull();
  });
});
