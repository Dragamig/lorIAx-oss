import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;

function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value === "string") out[prefix] = value;
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

function load(locale: string): Record<string, unknown> {
  const file = path.resolve(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("messages des tableaux de bord", () => {
  const fr = load("fr");
  const frKeys = Object.keys(flatten(fr.dashboards)).sort();

  it("libellé français de la barre latérale", () => {
    const shell = fr.shell as { quickNav: { dashboards: string } };
    expect(shell.quickNav.dashboards).toBe("Tableaux de bord");
    expect((fr.dashboards as { title: string }).title).toBe("Tableaux de bord");
  });

  it.each(LOCALES)("%s : mêmes clés que fr, aucune valeur vide", (locale) => {
    const messages = load(locale);
    const flat = flatten(messages.dashboards);
    expect(Object.keys(flat).sort()).toEqual(frKeys);
    for (const [key, value] of Object.entries(flat)) expect(value.trim(), key).not.toBe("");
    const pres = messages.presentations as Record<string, string>;
    expect(pres.spaceLabel?.trim()).toBeTruthy();
    expect(pres.readOnlyCreate?.trim()).toBeTruthy();
    const shell = messages.shell as { quickNav: { dashboards: string } };
    expect(shell.quickNav.dashboards.trim()).toBeTruthy();
  });
});
