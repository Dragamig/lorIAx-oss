import { describe, expect, it } from "vitest";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";
import de from "../../../messages/de.json";
import es from "../../../messages/es.json";
import br from "../../../messages/br.json";
import ja from "../../../messages/ja.json";
import zh from "../../../messages/zh.json";

type M = { chat: { creation: unknown }; admin: { ai: { creation: unknown } } };

const locales = { en, de, es, br, ja, zh } as unknown as Record<string, unknown>;

function flatten(o: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (v && typeof v === "object") Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = String(v);
  }
  return out;
}

const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");

describe.each([
  ["chat.creation", (m: M) => m.chat.creation],
  ["admin.ai.creation", (m: M) => m.admin.ai.creation],
])("messages %s", (_name, pick) => {
  const ref = flatten(pick(fr as M));
  it.each(Object.keys(locales))("%s : mêmes clés et mêmes placeholders que fr, aucun tiret cadratin", (loc) => {
    const got = flatten(pick(locales[loc] as M));
    expect(Object.keys(got).sort()).toEqual(Object.keys(ref).sort());
    for (const [k, v] of Object.entries(got)) {
      expect(placeholders(v), `${loc}:${k}`).toBe(placeholders(ref[k]));
      expect(v, `${loc}:${k}`).not.toMatch(/[–—]/);
    }
  });
});
