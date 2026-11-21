import { describe, it, expect } from "vitest";
import { validateImageUpload } from "./validate-upload";

const svgFile = (body: string) =>
  new File([`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`], "a.svg", { type: "image/svg+xml" });

describe("validateImageUpload, SVG", () => {
  it("refuse un SVG avec script ou gestionnaire", async () => {
    expect(await validateImageUpload(svgFile("<script>x()</script>"))).toMatchObject({ ok: false, status: 400 });
    expect(await validateImageUpload(svgFile('<rect onload="x()"/>'))).toMatchObject({ ok: false, status: 400 });
  });
  it("accepte un SVG inerte (logo de marque)", async () => {
    expect(await validateImageUpload(svgFile("<rect/>"))).toMatchObject({ ok: true });
  });
});
