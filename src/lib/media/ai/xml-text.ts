import { SaxesParser } from "saxes";

export type XmlTextOptions = {
  /** Si défini, seul le texte situé dans ces éléments (nom local) est retenu. */
  textElements?: ReadonlySet<string>;
  /** Fin de bloc : un saut de ligne est ajouté à la fermeture de ces éléments. */
  blockElements: ReadonlySet<string>;
  /** Éléments rendus par une tabulation / un espace / un saut de ligne. */
  tabElements?: ReadonlySet<string>;
  spaceElements?: ReadonlySet<string>;
  breakElements?: ReadonlySet<string>;
  maxChars: number;
};

const local = (n: string) => n.slice(n.indexOf(":") + 1);

/**
 * Texte d'un XML par parseur événementiel (saxes) : les entités externes et
 * celles d'un DTD ne sont jamais résolues (une entité non prédéfinie est une
 * erreur, donc `null`), aucune expression régulière sur le contenu. Arrêt dès
 * `maxChars`. `null` pour un XML mal formé.
 */
export function xmlToText(xml: Buffer, opts: XmlTextOptions): { text: string; truncated: boolean } | null {
  const parser = new SaxesParser({ xmlns: false });
  const parts: string[] = [];
  let length = 0;
  let truncated = false;
  let depthInText = 0;
  let failed = false;

  const push = (s: string) => {
    if (truncated) return;
    parts.push(s);
    length += s.length;
    if (length >= opts.maxChars) truncated = true;
  };

  parser.on("error", () => {
    failed = true;
  });
  parser.on("opentag", (tag) => {
    const n = local(tag.name);
    if (opts.textElements?.has(n)) depthInText++;
    if (opts.tabElements?.has(n)) push("\t");
    else if (opts.spaceElements?.has(n)) push(" ");
    else if (opts.breakElements?.has(n)) push("\n");
  });
  parser.on("closetag", (tag) => {
    const n = local(tag.name);
    if (opts.textElements?.has(n)) depthInText--;
    if (opts.blockElements.has(n)) push("\n");
  });
  parser.on("text", (t) => {
    if (!opts.textElements || depthInText > 0) push(t);
  });

  try {
    const CHUNK = 65_536;
    // Décodage en flux : un caractère multioctet coupé à la frontière est reporté au bloc suivant.
    const decoder = new TextDecoder("utf-8", { fatal: false });
    for (let i = 0; i < xml.length && !failed && !truncated; i += CHUNK) {
      const last = i + CHUNK >= xml.length;
      parser.write(decoder.decode(xml.subarray(i, i + CHUNK), { stream: !last }));
    }
    if (!failed && !truncated) parser.close();
  } catch {
    return null;
  }
  if (failed) return null;
  let text = parts.join("");
  if (text.length > opts.maxChars) {
    text = text.slice(0, opts.maxChars);
    truncated = true;
  }
  return { text, truncated };
}

export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[  ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
