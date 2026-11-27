import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["fr", "en", "br", "de", "es", "ja", "zh"] as const;

const EXPECTED_KEYS = [
  "entity",
  "untitled",
  "dialogLabel",
  "position",
  "positionOutOfList",
  "prev",
  "next",
  "prevDisabled",
  "prevDisabledOutOfList",
  "nextDisabled",
  "edgeFirst",
  "edgeLast",
  "fullscreen",
  "exitFullscreen",
  "fullscreenForced",
  "toastFullscreen",
  "toastSidePanel",
  "openInBases",
  "close",
  "loading",
  "errorTitle",
  "retry",
  "notFoundTitle",
  "notFoundBody",
  "noColumns",
  "cellSaved",
  "cellUndone",
  "cellError",
  "cellWriteError",
  "undo",
  "kbdEscape",
  "kbdFullscreen",
  "openRecord",
  "delete",
  "deleteReadOnly",
  "deleteTitle",
  "deleteBody",
  "deleteConfirm",
  "deleteCancel",
  "deleted",
  "deleteError",
  "restored",
  "restoreError",
].sort();

const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

function loadRecordSheet(locale: string): Record<string, string> {
  const file = path.resolve(process.cwd(), "messages", `${locale}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const ns = json.recordSheet;
  if (ns === undefined || ns === null || typeof ns !== "object") {
    throw new Error(`${locale}.json: namespace recordSheet absent`);
  }
  return ns as Record<string, string>;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, loadRecordSheet(l)]));

describe("recordSheet messages", () => {
  it("defines recordSheet in all 7 locales with the same keys as fr", () => {
    expect(EXPECTED_KEYS).toHaveLength(43);
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(EXPECTED_KEYS);
    }
  });

  it("keeps the same placeholders per key", () => {
    for (const key of EXPECTED_KEYS) {
      const reference = placeholders(messages.fr[key]);
      for (const locale of LOCALES) {
        expect(placeholders(messages[locale][key]), `${locale}.${key}`).toEqual(reference);
      }
    }
  });

  it("contains no em dash or en dash", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.includes(EM_DASH), `${locale}.${key}`).toBe(false);
        expect(value.includes(EN_DASH), `${locale}.${key}`).toBe(false);
      }
    }
  });

  it("has no empty value", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
