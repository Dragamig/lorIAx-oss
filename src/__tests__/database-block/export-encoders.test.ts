import { describe, it, expect } from "vitest";
import {
  renderCsv,
  formatValue,
  sanitizeFilename,
  type ExportColumn,
} from "@/lib/bases/export-encoders";

const cols: ExportColumn[] = [
  { id: "c_name", name: "Nom", type: "text", position: 0 },
  { id: "c_note", name: "Note", type: "text", position: 1 },
];

describe("renderCsv", () => {
  it("préfixe un BOM UTF-8 et sépare les lignes en CRLF", () => {
    const out = renderCsv(cols, [{ cells: { c_name: "Alice", c_note: "ok" } }]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("Nom,Note\r\nAlice,ok");
  });

  it("échappe les guillemets, virgules et retours à la ligne (RFC 4180)", () => {
    const out = renderCsv(cols, [
      { cells: { c_name: 'a,b', c_note: 'dit "salut"' } },
    ]);
    expect(out).toContain('"a,b","dit ""salut"""');
  });

  // Neutralisation de l'injection de formule CSV/Excel.
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "préfixe une apostrophe devant une valeur commençant par %j",
    (payload) => {
      const out = renderCsv(cols, [{ cells: { c_name: payload, c_note: "" } }]);
      const firstCell = out.replace("﻿", "").split("\r\n")[1].split(",")[0];
      // La cellule doit commencer par une apostrophe (éventuellement quotée).
      expect(firstCell.replace(/^"/, "").startsWith("'")).toBe(true);
    }
  );

  it("ne touche pas une valeur bénigne", () => {
    const out = renderCsv(cols, [{ cells: { c_name: "Bonjour", c_note: "" } }]);
    expect(out).toContain("\r\nBonjour,");
  });

  it("neutralise une formule contenant aussi une virgule (préfixe + quoting)", () => {
    const out = renderCsv(cols, [
      { cells: { c_name: "=HYPERLINK(1,2)", c_note: "" } },
    ]);
    expect(out).toContain('"\'=HYPERLINK(1,2)"');
  });
});

describe("formatValue", () => {
  it("rend les booléens et les valeurs nulles", () => {
    expect(formatValue(true)).toBe("vrai");
    expect(formatValue(false)).toBe("faux");
    expect(formatValue(null)).toBe("");
    expect(formatValue(undefined)).toBe("");
  });

  it("joint les tableaux et extrait les filenames", () => {
    expect(formatValue(["a", "b"])).toBe("a; b");
    expect(formatValue([{ filename: "doc.pdf" }])).toBe("doc.pdf");
  });
});

describe("sanitizeFilename", () => {
  it("retire les caractères interdits et borne la longueur", () => {
    expect(sanitizeFilename('a/b:c*?"<>|d')).toBe("a-b-c------d");
    expect(sanitizeFilename("x".repeat(300)).length).toBe(200);
  });
});
