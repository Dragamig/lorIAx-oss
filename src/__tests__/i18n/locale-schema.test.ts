import { describe, it, expect } from "vitest";
import { LocaleSchema, LOCALES } from "@/i18n/config";
import { localeEnum } from "@/lib/db/schema";

describe("LocaleSchema", () => {
  it("accepte les 7 locales valides", () => {
    for (const locale of LOCALES) {
      expect(LocaleSchema.safeParse(locale).success).toBe(true);
    }
  });

  it("rejette les valeurs invalides", () => {
    for (const bad of ["", "pt", "FR", "zh-TW", 42, null, undefined]) {
      expect(LocaleSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("localeEnum (drizzle schema drift guard)", () => {
  it("contient exactement les mêmes valeurs que LOCALES", () => {
    const enumValues = new Set(localeEnum.enumValues);
    const configValues = new Set<string>(LOCALES);
    expect(enumValues).toEqual(configValues);
  });

  it("ne contient aucune valeur de plus que LOCALES", () => {
    expect(localeEnum.enumValues.length).toBe(LOCALES.length);
  });
});
