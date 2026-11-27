import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["br", "de", "en", "es", "fr", "ja", "zh"] as const;

function crmOf(locale: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"));
  return (raw.crm ?? {}) as Record<string, unknown>;
}

/** Feuilles du namespace `crm` : chemin pointé vers valeur. */
function leaves(node: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = node;
  }
  return out;
}

const reference = leaves(crmOf("fr"));

describe("parité des messages crm.* sur les 7 locales", () => {
  it("fr.json porte des clés crm", () => {
    expect(Object.keys(reference).length).toBeGreaterThan(0);
  });

  describe.each(LOCALES.filter((l) => l !== "fr"))("%s", (locale) => {
    const own = leaves(crmOf(locale));
    it("mêmes clés que fr.json, dans les deux sens", () => {
      const refKeys = Object.keys(reference);
      const ownKeys = Object.keys(own);
      expect(refKeys.filter((k) => !(k in own)).sort(), "clés manquantes").toEqual([]);
      expect(ownKeys.filter((k) => !(k in reference)).sort(), "clés en trop").toEqual([]);
    });
  });

  describe.each(LOCALES)("%s : valeurs", (locale) => {
    const own = leaves(crmOf(locale));
    it("aucune valeur vide, aucun tiret cadratin ni demi-cadratin", () => {
      for (const [k, v] of Object.entries(own)) {
        expect(typeof v, k).toBe("string");
        expect((v as string).trim(), k).not.toBe("");
        expect(v as string, k).not.toMatch(/[–—]/);
      }
    });
  });

  describe.each(LOCALES)("%s : bloc fiche.activity", (locale) => {
    const own = leaves(crmOf(locale));
    const placeholders = (v: unknown) => (String(v).match(/\{[^}]+\}/g) ?? []).sort();
    const keys = Object.keys(reference).filter((k) => k.startsWith("fiche.activity."));
    it("porte le bloc complet, y compris les clés du registre d'actions", () => {
      for (const k of [
        "fiche.activity.filter", "fiche.activity.filterTip", "fiche.activity.mail.toggle",
        "fiche.activity.mail.toggleTip", "fiche.activity.mail.cancel", "fiche.activity.mail.cancelTip",
        "fiche.activity.mail.retry", "fiche.activity.mail.retryTip", "fiche.activity.task.done",
        "fiche.activity.task.doneTip", "fiche.activity.mail.badge.failed", "fiche.activity.mail.errors.trace_pending",
      ]) {
        expect(k in own, k).toBe(true);
      }
      expect(keys.length).toBeGreaterThan(50);
    });
    it("mêmes variables que fr.json", () => {
      for (const k of keys) expect(placeholders(own[k]), k).toEqual(placeholders(reference[k]));
    });
  });
});
