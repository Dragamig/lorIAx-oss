import { MAX_TEXT_CHARS } from "./limits";
import { openSafeZip } from "./safe-zip";
import { normalizeText, xmlToText, type XmlTextOptions } from "./xml-text";

export type OfficeFormat = "docx" | "odt" | "pptx" | "odp";

const set = (...v: string[]) => new Set(v);

const DOCX: XmlTextOptions = {
  textElements: set("t"),
  blockElements: set("p"),
  tabElements: set("tab"),
  breakElements: set("br"),
  maxChars: MAX_TEXT_CHARS,
};
const PPTX: XmlTextOptions = {
  textElements: set("t"),
  blockElements: set("p"),
  breakElements: set("br"),
  maxChars: MAX_TEXT_CHARS,
};
const ODF: XmlTextOptions = {
  blockElements: set("p", "h"),
  tabElements: set("tab"),
  spaceElements: set("s"),
  breakElements: set("line-break"),
  maxChars: MAX_TEXT_CHARS,
};

/** Numéro de diapositive : ordre numérique (slide2 avant slide10). */
function slideNumber(name: string): number | null {
  const m = /^ppt\/slides\/slide(\d{1,6})\.xml$/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Texte d'un document bureautique (docx, odt, pptx, odp). Archive lue avec
 * décompression bornée (voir safe-zip.ts) : seules les entrées XML de contenu
 * sont lues. `null` pour une archive illisible, hostile ou sans contenu lisible.
 */
export async function extractOfficeText(
  buffer: Buffer,
  format: OfficeFormat,
): Promise<{ text: string; truncated: boolean } | null> {
  try {
    const zip = await openSafeZip(buffer);
    let blocks: string[] = [];
    let truncated = false;

    if (format === "docx" || format === "odt" || format === "odp") {
      const name = format === "docx" ? "word/document.xml" : "content.xml";
      const xml = await zip.read(name);
      if (!xml) return null;
      const r = xmlToText(xml, format === "docx" ? DOCX : ODF);
      if (!r) return null;
      blocks = [r.text];
      truncated = r.truncated;
    } else {
      const slides = zip
        .names()
        .map((n) => ({ n, i: slideNumber(n) }))
        .filter((s): s is { n: string; i: number } => s.i !== null)
        .sort((a, b) => a.i - b.i);
      if (slides.length === 0) return null;
      let used = 0;
      for (const s of slides) {
        const xml = await zip.read(s.n);
        if (!xml) continue;
        const r = xmlToText(xml, { ...PPTX, maxChars: MAX_TEXT_CHARS - used });
        if (!r) return null;
        const t = normalizeText(r.text);
        if (t) {
          blocks.push(t);
          used += t.length + 2;
        }
        if (r.truncated || used >= MAX_TEXT_CHARS) {
          truncated = true;
          break;
        }
      }
    }

    let text = normalizeText(blocks.join("\n\n"));
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      truncated = true;
    }
    return { text, truncated };
  } catch {
    return null;
  }
}
