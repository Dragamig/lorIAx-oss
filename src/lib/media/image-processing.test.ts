import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage, sha256Hex } from "./image-processing";

const base = () => sharp({ create: { width: 800, height: 400, channels: 3, background: "#09f" } });

describe("processImage", () => {
  it("dimensions et miniature 320 px", async () => {
    const buf = await base().png().toBuffer();
    const r = await processImage(buf, "image/png");
    expect(r.width).toBe(800);
    expect(r.height).toBe(400);
    expect(r.thumbnailMime).toBe("image/webp");
    const meta = await sharp(r.thumbnail!).metadata();
    expect(meta.width).toBe(320);
    expect(meta.format).toBe("webp");
  });
  it("detecte un EXIF GPS", async () => {
    const buf = await base()
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await processImage(buf, "image/jpeg")).hasLocationExif).toBe(true);
  });
  it("pas de GPS sans EXIF", async () => {
    const buf = await base().jpeg().toBuffer();
    expect((await processImage(buf, "image/jpeg")).hasLocationExif).toBe(false);
  });
  it("orientation EXIF 6 : largeur et hauteur échangées", async () => {
    const buf = await base().withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await processImage(buf, "image/jpeg");
    expect(r.width).toBe(400);
    expect(r.height).toBe(800);
  });
  it("svg : tout a null", async () => {
    const r = await processImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml");
    expect(r).toEqual({ width: null, height: null, thumbnail: null, thumbnailMime: null, hasLocationExif: false });
  });
});

describe("sha256Hex", () => {
  it("hash connu", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
