import { describe, it, expect } from "vitest";
import {
  PAGE_FORMATS,
  FORMAT_LABELS,
  FORMAT_GROUPS,
  type PageFormat,
} from "@/components/editor/extensions/design-constants";

describe("design-constants — formats de page", () => {
  it("conserve les formats historiques (compat documents existants)", () => {
    expect(PAGE_FORMATS["a4-portrait"]).toEqual({ width: 595, height: 842 });
    expect(PAGE_FORMATS["a4-landscape"]).toEqual({ width: 842, height: 595 });
    expect(PAGE_FORMATS["square"]).toEqual({ width: 800, height: 800 });
    expect(PAGE_FORMATS["free"]).toEqual({ width: 800, height: 600 });
  });

  it("expose les formats réseaux sociaux standard du marché", () => {
    expect(PAGE_FORMATS["social-square"]).toEqual({ width: 1080, height: 1080 });
    expect(PAGE_FORMATS["social-portrait"]).toEqual({ width: 1080, height: 1350 });
    expect(PAGE_FORMATS["social-story"]).toEqual({ width: 1080, height: 1920 });
    expect(PAGE_FORMATS["social-wide"]).toEqual({ width: 1920, height: 1080 });
  });

  it("a un label français pour chaque format", () => {
    for (const key of Object.keys(PAGE_FORMATS) as PageFormat[]) {
      expect(FORMAT_LABELS[key]).toBeTruthy();
    }
  });

  it("groupe tous les formats sans doublon ni oubli", () => {
    const grouped = FORMAT_GROUPS.flatMap((g) => g.formats);
    expect(grouped.sort()).toEqual((Object.keys(PAGE_FORMATS) as PageFormat[]).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
