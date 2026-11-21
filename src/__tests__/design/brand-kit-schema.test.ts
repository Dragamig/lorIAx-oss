import { describe, it, expect } from "vitest";
import { brandKitSchema, EMPTY_BRAND_KIT } from "@/lib/studio/brand-kit-schema";

describe("brandKitSchema", () => {
  it("accepte un kit valide", () => {
    const r = brandKitSchema.safeParse({
      colors: ["#7C3AED", "#111111"],
      logos: [{ url: "/api/studio/images/abc", name: "Logo principal" }],
      fontHeading: "Plus Jakarta Sans",
      fontBody: "Source Serif 4",
    });
    expect(r.success).toBe(true);
  });

  it("accepte le kit vide par défaut", () => {
    expect(brandKitSchema.safeParse(EMPTY_BRAND_KIT).success).toBe(true);
  });

  it("rejette une couleur non hexadécimale", () => {
    expect(brandKitSchema.safeParse({ ...EMPTY_BRAND_KIT, colors: ["rouge"] }).success).toBe(false);
    expect(brandKitSchema.safeParse({ ...EMPTY_BRAND_KIT, colors: ["#GGGGGG"] }).success).toBe(false);
  });

  it("rejette plus de 12 couleurs / 8 logos", () => {
    expect(brandKitSchema.safeParse({ ...EMPTY_BRAND_KIT, colors: Array(13).fill("#000000") }).success).toBe(false);
    const logo = { url: "/x", name: "l" };
    expect(brandKitSchema.safeParse({ ...EMPTY_BRAND_KIT, logos: Array(9).fill(logo) }).success).toBe(false);
  });

  it("rejette une URL de logo javascript:", () => {
    const r = brandKitSchema.safeParse({
      ...EMPTY_BRAND_KIT,
      logos: [{ url: "javascript:alert(1)", name: "x" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejette une URL de logo protocol-relative (//evil.com)", () => {
    const r = brandKitSchema.safeParse({
      ...EMPTY_BRAND_KIT,
      logos: [{ url: "//evil.com/logo.png", name: "x" }],
    });
    expect(r.success).toBe(false);
  });

  describe("logos de la médiathèque", () => {
    const ID = "0b1c2d3e-0000-4000-8000-000000000000";
    const kit = (url: string) => ({ ...EMPTY_BRAND_KIT, logos: [{ url, name: "l" }] });

    it("accepte /api/media/<uuid>", () => {
      expect(brandKitSchema.safeParse(kit(`/api/media/${ID}`)).success).toBe(true);
    });

    it.each([
      "/api/media/../x",
      "/api/media/abc",
      `/api/media/${ID}/x`,
      `/api/media/${ID}?a=1`,
      "//evil.com/x",
      "javascript:alert(1)",
    ])("refuse %s", (url) => {
      expect(brandKitSchema.safeParse(kit(url)).success).toBe(false);
    });

    it("conserve la limite de 8 logos", () => {
      const logo = { url: `/api/media/${ID}`, name: "l" };
      expect(brandKitSchema.safeParse({ ...EMPTY_BRAND_KIT, logos: Array(8).fill(logo) }).success).toBe(true);
      expect(brandKitSchema.safeParse({ ...EMPTY_BRAND_KIT, logos: Array(9).fill(logo) }).success).toBe(false);
    });
  });
});
