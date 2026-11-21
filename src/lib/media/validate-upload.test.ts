import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { validateUpload, MAX_UPLOAD_BYTES } from "./validate-upload";

async function png() {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } }).png().toBuffer();
}

describe("validateUpload", () => {
  it("refuse un .exe", async () => {
    const r = await validateUpload({ name: "a.exe", size: 10, type: "application/x-msdownload" }, Buffer.from("MZ"));
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  it("refuse un .pdf dont le contenu est un PNG", async () => {
    const b = await png();
    const r = await validateUpload({ name: "a.pdf", size: b.length, type: "application/pdf" }, b);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  it("415 sur binaire sans signature", async () => {
    const r = await validateUpload({ name: "a.pdf", size: 8, type: "application/pdf" }, Buffer.from("12345678"));
    expect(r).toMatchObject({ ok: false, status: 415 });
  });
  it("413 au-dela de 50 Mo", async () => {
    const r = await validateUpload({ name: "a.pdf", size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" }, Buffer.alloc(1));
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
  it("accepte un PNG valide", async () => {
    const b = await png();
    const r = await validateUpload({ name: "../x.png", size: b.length, type: "image/png" }, b);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ext).toBe("png");
      expect(r.safeName).not.toContain("../");
      expect(r.mime).toBe("image/png");
    }
  });
  it("accepte un .txt sans magic bytes", async () => {
    const r = await validateUpload({ name: "n.txt", size: 5, type: "text/plain" }, Buffer.from("hello"));
    expect(r.ok).toBe(true);
  });
  it("dérive le mime d'un fichier texte de l'extension", async () => {
    const r = await validateUpload({ name: "a.svg", size: 5, type: "video/mp4" }, Buffer.from("<svg/>"));
    expect(r).toMatchObject({ ok: true, mime: "image/svg+xml" });
  });
  it("nettoie le nom", async () => {
    const b = await png();
    const r = await validateUpload({ name: "..\\..\\a<b>.png", size: b.length, type: "image/png" }, b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.safeName).toBe("a_b_.png");
  });
});

describe("validateUpload, SVG (H9)", () => {
  const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  const call = (b: Buffer, name = "a.svg") =>
    validateUpload({ name, size: b.length, type: "image/svg+xml" }, b);

  it("rejects_svg_upload_in_media_validate : script", async () => {
    expect(await call(svg("<script>alert(1)</script>"))).toMatchObject({ ok: false, status: 400 });
  });
  it("refuse un gestionnaire d'evenement et javascript:", async () => {
    expect(await call(svg('<rect onload="x()"/>'))).toMatchObject({ ok: false });
    expect(await call(svg('<a href="javascript:x()"/>'))).toMatchObject({ ok: false });
  });
  it("refuse un HTML deguise en .svg", async () => {
    expect(await call(Buffer.from("<html><body>x</body></html>"))).toMatchObject({ ok: false });
  });
  it("accepte un SVG inerte", async () => {
    expect(await call(svg('<rect width="1" height="1"/>'))).toMatchObject({ ok: true, mime: "image/svg+xml" });
  });
});

describe("validateUpload, profil video", () => {
  // En-tête QuickTime : file-type détecte video/quicktime (.mov).
  const mov = Buffer.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0, 0x71, 0x74, 0x20, 0x20]);
  const size150 = 150 * 1024 * 1024;

  it("accepte un .mov de 150 Mo", async () => {
    const r = await validateUpload({ name: "clip.mov", size: size150, type: "video/quicktime" }, mov, "video");
    expect(r).toMatchObject({ ok: true, ext: "mov", mime: "video/quicktime" });
  });
  it("refuse le même fichier avec le profil par défaut", async () => {
    const r = await validateUpload({ name: "clip.mov", size: size150, type: "video/quicktime" }, mov);
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
  it("refuse un .mov dont le contenu est une image (415)", async () => {
    const b = await png();
    const r = await validateUpload({ name: "clip.mov", size: b.length, type: "video/quicktime" }, b, "video");
    expect(r).toMatchObject({ ok: false, status: 415 });
  });
  it("refuse un type hors liste (400) et au-delà de 200 Mo (413)", async () => {
    expect(await validateUpload({ name: "a.pdf", size: 5, type: "application/pdf" }, mov, "video")).toMatchObject({ ok: false, status: 400 });
    expect(await validateUpload({ name: "a.mov", size: 201 * 1024 * 1024, type: "video/quicktime" }, mov, "video")).toMatchObject({ ok: false, status: 413 });
  });
});
