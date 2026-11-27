import Papa from "papaparse";
import { SaxesParser } from "saxes";
import { MAX_SHEET_CELLS, MAX_SHEET_COUNT, MAX_TEXT_CHARS } from "./limits";
import { openSafeZip, type SafeZip } from "./safe-zip";

export type SheetFormat = "xlsx" | "csv";
type Out = { text: string; truncated: boolean };

const local = (n: string) => n.slice(n.indexOf(":") + 1);

/** Parcourt un XML (flux de 64 Ko) ; `false` si mal formé. */
function parseXml(
  xml: Buffer,
  on: (p: SaxesParser) => void,
  stop: () => boolean = () => false,
): boolean {
  const parser = new SaxesParser({ xmlns: false });
  let failed = false;
  parser.on("error", () => {
    failed = true;
  });
  on(parser);
  try {
    for (let i = 0; i < xml.length && !failed && !stop(); i += 65_536) {
      parser.write(xml.subarray(i, i + 65_536).toString("utf8"));
    }
    if (!failed && !stop()) parser.close();
  } catch {
    return false;
  }
  return !failed;
}

async function sharedStrings(zip: SafeZip): Promise<string[] | null> {
  const xml = await zip.read("xl/sharedStrings.xml");
  if (!xml) return [];
  const list: string[] = [];
  let cur = "";
  let inSi = false;
  let inT = false;
  const ok = parseXml(xml, (p) => {
    p.on("opentag", (t) => {
      const n = local(t.name);
      if (n === "si") {
        inSi = true;
        cur = "";
      } else if (n === "t" && inSi) inT = true;
    });
    p.on("text", (s) => {
      if (inT) cur += s;
    });
    p.on("closetag", (t) => {
      const n = local(t.name);
      if (n === "t") inT = false;
      else if (n === "si") {
        inSi = false;
        list.push(cur);
      }
    });
  });
  return ok ? list : null;
}

/** Feuilles (nom + chemin de l'entrée) dans l'ordre du classeur. */
async function sheetList(zip: SafeZip): Promise<{ name: string; path: string }[] | null> {
  const wb = await zip.read("xl/workbook.xml");
  const rels = await zip.read("xl/_rels/workbook.xml.rels");
  if (!wb || !rels) return null;
  const sheets: { name: string; rid: string }[] = [];
  const targets = new Map<string, string>();
  const a = parseXml(wb, (p) =>
    p.on("opentag", (t) => {
      if (local(t.name) === "sheet") {
        const rid = t.attributes["r:id"] ?? t.attributes["id"];
        if (typeof rid === "string") sheets.push({ name: String(t.attributes["name"] ?? ""), rid });
      }
    }),
  );
  const b = parseXml(rels, (p) =>
    p.on("opentag", (t) => {
      if (local(t.name) === "Relationship") {
        targets.set(String(t.attributes["Id"]), String(t.attributes["Target"]));
      }
    }),
  );
  if (!a || !b) return null;
  const out: { name: string; path: string }[] = [];
  for (const s of sheets) {
    const target = targets.get(s.rid);
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    out.push({ name: s.name, path });
  }
  return out;
}

async function extractXlsx(buffer: Buffer): Promise<Out | null> {
  const zip = await openSafeZip(buffer);
  const strings = await sharedStrings(zip);
  const sheets = await sheetList(zip);
  if (!strings || !sheets || sheets.length === 0) return null;

  let truncated = sheets.length > MAX_SHEET_COUNT;
  let cells = 0;
  const out: string[] = [];

  for (const sheet of sheets.slice(0, MAX_SHEET_COUNT)) {
    const xml = await zip.read(sheet.path);
    if (!xml) continue;
    const rows: string[] = [];
    let row: string[] = [];
    let type = "";
    let inV = false;
    let inInlineT = false;
    let value = "";
    const full = () => cells >= MAX_SHEET_CELLS;
    const ok = parseXml(
      xml,
      (p) => {
        p.on("opentag", (t) => {
          const n = local(t.name);
          if (n === "c") {
            type = String(t.attributes["t"] ?? "");
            value = "";
          } else if (n === "v") inV = true;
          else if (n === "t" && type === "inlineStr") inInlineT = true;
        });
        p.on("text", (s) => {
          if (inV || inInlineT) value += s;
        });
        p.on("closetag", (t) => {
          const n = local(t.name);
          if (n === "v") inV = false;
          else if (n === "t") inInlineT = false;
          else if (n === "c") {
            let v = value;
            if (type === "s") v = strings[Number(value)] ?? "";
            else if (type === "b") v = value === "1" ? "TRUE" : value === "0" ? "FALSE" : value;
            else if (type === "e") v = "";
            if (v !== "") {
              row.push(v);
              cells++;
            }
          } else if (n === "row") {
            if (row.length) rows.push(row.join("\t"));
            row = [];
          }
        });
      },
      full,
    );
    if (!ok && !full()) return null;
    if (row.length) rows.push(row.join("\t"));
    out.push(`# ${sheet.name}\n${rows.join("\n")}`);
    if (full()) {
      truncated = true;
      break;
    }
  }

  let text = out.join("\n\n").trim();
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }
  return { text, truncated };
}

function extractCsv(buffer: Buffer): Out | null {
  let src = buffer.toString("utf8");
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const rows: string[] = [];
  let cells = 0;
  let truncated = false;
  Papa.parse<string[]>(src, {
    skipEmptyLines: true,
    step: (res, parser) => {
      const line = (res.data as string[]).filter((c) => c !== "");
      cells += line.length;
      if (line.length) rows.push(line.join("\t"));
      if (cells >= MAX_SHEET_CELLS) {
        truncated = true;
        parser.abort();
      }
    },
  });
  let text = rows.join("\n");
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }
  return { text, truncated };
}

/**
 * Texte d'un tableur : xlsx (lu sans exceljs, par l'archive bornée de safe-zip
 * et un parseur XML événementiel ; formules rendues par leur valeur en cache)
 * ou csv. Plafonds : `MAX_SHEET_CELLS` cellules, `MAX_SHEET_COUNT` feuilles.
 * `null` pour un fichier illisible ou hostile.
 */
export async function extractSheetText(buffer: Buffer, format: SheetFormat): Promise<Out | null> {
  try {
    return format === "csv" ? extractCsv(buffer) : await extractXlsx(buffer);
  } catch {
    return null;
  }
}
