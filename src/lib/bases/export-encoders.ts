/**
 * Encodeurs purs pour l'export d'une base — extraits de la route API pour
 * pouvoir être testés sans charger Next.js.
 */

export interface ExportColumn {
  id: string;
  name: string;
  type: string;
  position: number;
}

export interface ExportRow {
  cells: unknown;
}

/** Encode une base en CSV RFC 4180 (avec BOM UTF-8 pour Excel). */
export function renderCsv(columns: ExportColumn[], rows: ExportRow[]): string {
  const header = columns.map((c) => csvCell(c.name)).join(",");
  const body = rows
    .map((r) => {
      const cells = typeof r.cells === 'object' && r.cells !== null ? (r.cells as Record<string, unknown>) : {};
      return columns.map((c) => csvCell(formatValue(cells[c.id]))).join(",");
    })
    .join("\r\n");
  return `﻿${header}\r\n${body}`;
}

function csvCell(v: string): string {
  // Neutralisation de l'injection de formule (CSV/Excel/LibreOffice) : une
  // cellule commençant par = + - @ ou par une tabulation/retour chariot peut
  // être interprétée comme une formule à l'ouverture du fichier. On préfixe
  // alors une apostrophe pour forcer le tableur à la traiter comme du texte.
  // Vecteur réel ici car des valeurs peuvent provenir de formulaires publics.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** Normalise une valeur de cellule pour un export tabulaire. */
export function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "vrai" : "faux";
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        x && typeof x === "object"
          ? "filename" in x
            ? String((x as { filename: string }).filename)
            : JSON.stringify(x)
          : String(x)
      )
      .join("; ");
  }
  if (typeof v === "object") {
    if ("filename" in (v as object)) return String((v as { filename: string }).filename);
    return JSON.stringify(v);
  }
  return String(v);
}

/** Génère un nom de fichier sûr (supprime les caractères interdits sur FS) */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);
}
