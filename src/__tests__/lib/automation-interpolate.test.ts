import { afterEach, describe, expect, it } from "vitest";
import {
  interpolate,
  interpolateCells,
  placeholderRegex,
  setAutomationClock,
} from "@/lib/automations/interpolate";
import { coerceCellsByColumnType } from "@/lib/automations/cell-coercion";
import { scanMarkdownPlaceholders } from "@/lib/automations/template-variables";

const UUID = "3f2b8c1e-9a4d-4e7b-8c11-0d5e6f7a8b9c";

afterEach(() => setAutomationClock(null));

describe("cells avec chemin", () => {
  it("résout cells.<colonne>.0 dans un tableau", () => {
    expect(interpolate(`{{cells.${UUID}.0}}`, { cells: { [UUID]: ["rel-1", "rel-2"] } })).toBe("rel-1");
    expect(interpolate(`{{cells.${UUID}.1}}`, { cells: { [UUID]: ["rel-1", "rel-2"] } })).toBe("rel-2");
  });
  it("résout un sous-champ d'objet et vide si absent", () => {
    expect(interpolate("{{cells.c.a.b}}", { cells: { c: { a: { b: "x" } } } })).toBe("x");
    expect(interpolate("{{cells.c.5}}", { cells: { c: ["a"] } })).toBe("");
    expect(interpolate("{{cells.zz.0}}", { cells: {} })).toBe("");
  });
  it("la clé à plat reste prioritaire", () => {
    expect(interpolate("{{cells.a.b}}", { cells: { "a.b": "flat", a: { b: "deep" } } })).toBe("flat");
  });
});

describe("motif de placeholder", () => {
  it("accepte les uuid dans cells", () => {
    expect(interpolate(`{{cells.${UUID}}}`, { cells: { [UUID]: "ok" } })).toBe("ok");
  });
  it("résout un chemin variables profond avec index", () => {
    const variables = { body: { data: { fields: [{ value: "Alice" }] } } };
    expect(interpolate("{{variables.body.data.fields.0.value}}", { variables })).toBe("Alice");
  });
  it("le scan markdown partage le motif", () => {
    const keys = scanMarkdownPlaceholders(`{{a-b}} {{today}} {{cells.${UUID}}}`).map((v) => v.key);
    expect(keys).toEqual(["a-b"]);
    expect(placeholderRegex().source).toContain("w.+-");
  });
});

describe("jetons de date", () => {
  it("calcule today, today+N, today-N en Europe/Paris", () => {
    // 23:30 UTC le 27/10 = 00:30 le 28/10 à Paris (UTC+1 après le passage à l'heure d'hiver : 28/10 00:30)
    setAutomationClock(() => new Date("2026-10-27T23:30:00Z"));
    expect(interpolate("{{today}}", {})).toBe("2026-10-28");
    expect(interpolate("{{today+7}}", {})).toBe("2026-11-04");
    expect(interpolate("{{today-3}}", {})).toBe("2026-10-25");
    expect(interpolate("{{ today+1 }}", {})).toBe("2026-10-29");
  });
  it("now renvoie l'ISO complet", () => {
    setAutomationClock(() => new Date("2026-10-28T10:00:00Z"));
    expect(interpolate("{{now}}", {})).toBe("2026-10-28T10:00:00.000Z");
  });
});

describe("interpolateCells", () => {
  it("interpole récursivement tableaux et objets", () => {
    const out = interpolateCells(
      { a: ["{{rowId}}", "x"], b: { c: "{{event}}", d: 3 }, e: 5 },
      { rowId: "r1", event: "ev" }
    );
    expect(out).toEqual({ a: ["r1", "x"], b: { c: "ev", d: 3 }, e: 5 });
  });
});

describe("coerceCellsByColumnType", () => {
  const types = { rel: "relation", n: "number", c: "checkbox", d: "date", t: "text" };
  it("relation", () => {
    expect(coerceCellsByColumnType({ rel: "abc" }, types)).toEqual({ rel: ["abc"] });
    expect(coerceCellsByColumnType({ rel: ["a", "", " b "] }, types)).toEqual({ rel: ["a", "b"] });
    expect(coerceCellsByColumnType({ rel: "" }, types)).toEqual({});
    expect(coerceCellsByColumnType({ rel: [] }, types)).toEqual({});
  });
  it("nombre", () => {
    expect(coerceCellsByColumnType({ n: "12,5" }, types)).toEqual({ n: 12.5 });
    expect(coerceCellsByColumnType({ n: "abc" }, types)).toEqual({});
    expect(coerceCellsByColumnType({ n: "" }, types)).toEqual({});
  });
  it("case à cocher", () => {
    expect(coerceCellsByColumnType({ c: "Oui" }, types)).toEqual({ c: true });
    expect(coerceCellsByColumnType({ c: "false" }, types)).toEqual({ c: false });
  });
  it("date", () => {
    expect(coerceCellsByColumnType({ d: "2026-11-04" }, types)).toEqual({ d: "2026-11-04" });
    expect(coerceCellsByColumnType({ d: "pas une date" }, types)).toEqual({});
    expect(coerceCellsByColumnType({ d: "" }, types)).toEqual({});
  });
  it("type inconnu ou texte inchangé", () => {
    expect(coerceCellsByColumnType({ t: "x", z: "y" }, types)).toEqual({ t: "x", z: "y" });
  });
});
