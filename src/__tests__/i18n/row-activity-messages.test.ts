import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;
const EM_DASH = "—";
const EN_DASH = "–";

function load(locale: string): Record<string, string> {
  const file = path.resolve(process.cwd(), "messages", `${locale}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (!json.rowActivity || typeof json.rowActivity !== "object") {
    throw new Error(`${locale}.json: namespace rowActivity absent`);
  }
  return json.rowActivity as Record<string, string>;
}

const placeholders = (v: string) => [...v.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)]));

describe("rowActivity messages", () => {
  it("has the same keys as fr in all 7 locales", () => {
    const keys = Object.keys(messages.fr).sort();
    expect(keys.length).toBeGreaterThan(30);
    for (const l of LOCALES) expect(Object.keys(messages[l]).sort(), l).toEqual(keys);
  });

  it("keeps the same placeholders per key", () => {
    for (const key of Object.keys(messages.fr)) {
      for (const l of LOCALES) {
        expect(placeholders(messages[l][key]), `${l}.${key}`).toEqual(placeholders(messages.fr[key]));
      }
    }
  });

  it("has no dash punctuation and no empty value", () => {
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(messages[l])) {
        expect(v.includes(EM_DASH) || v.includes(EN_DASH), `${l}.${k}`).toBe(false);
        expect(v.trim().length, `${l}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("has the comment and task-event keys and plural forms", () => {
    for (const l of LOCALES) {
      for (const key of ["tabActivity", "tabTasks", "composerCount", "commentDisabledViewer", "taskCreatedEvent", "taskTitleFallback", "clearBody"]) {
        expect(messages[l][key], `${l}.${key}`).toBeTruthy();
      }
      expect(messages[l].tasksBadge, `${l}.tasksBadge`).toContain("plural");
    }
    expect(placeholders(messages.fr.composerCount)).toEqual(["count", "max"]);
    expect(placeholders(messages.fr.taskCreatedEvent)).toEqual(["actor", "title"]);
  });
});
