/**
 * Génération de documents (PDF / DOCX) pour l'action d'automatisation « IA » (C4).
 *
 * Libs pures JS (pdf-lib, docx) — aucune dépendance Chromium/native, conforme à
 * l'architecture frugale. Les helpers `wrapText` et `buildDocumentKey` sont purs
 * et testés ; la génération de buffers (PDF/DOCX) est isolée ici, l'upload S3
 * reste dans l'executor.
 */

export type DocumentFormat = "pdf" | "docx";

export const DOCUMENT_EXT: Record<DocumentFormat, string> = {
  pdf: "pdf",
  docx: "docx",
};

export const DOCUMENT_MIME: Record<DocumentFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Découpe un texte en lignes d'au plus `maxCharsPerLine` caractères.
 *
 * Les retours à la ligne existants sont préservés (chaque paragraphe est
 * enveloppé indépendamment, les lignes vides aussi). Les mots plus longs que la
 * largeur max sont coupés durement pour ne jamais déborder. Fonction pure.
 */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const max = Math.max(1, Math.floor(maxCharsPerLine));
  const out: string[] = [];

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.trim() === "") {
      out.push("");
      continue;
    }
    let current = "";
    for (const word of rawLine.split(/\s+/)) {
      // Mot seul trop long → coupe en tranches de `max`.
      if (word.length > max) {
        if (current) {
          out.push(current);
          current = "";
        }
        for (let i = 0; i < word.length; i += max) {
          const chunk = word.slice(i, i + max);
          if (chunk.length === max) out.push(chunk);
          else current = chunk;
        }
        continue;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > max) {
        out.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) out.push(current);
  }

  return out;
}

/**
 * Clé S3 stable d'un document généré. Fonction pure (timestamp injecté).
 * Forme : `automations/<automationId>/<timestamp>.<ext>`.
 */
export function buildDocumentKey(
  automationId: string,
  format: DocumentFormat,
  nowMs: number
): string {
  return `automations/${automationId}/${nowMs}.${DOCUMENT_EXT[format]}`;
}

/** Génère un PDF A4 simple (titre + corps), polices standard Helvetica. */
export async function generatePdf(title: string, body: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4 en points
  const pageHeight = 841.89;
  const margin = 56;
  const fontSize = 11;
  const titleSize = 18;
  const lineHeight = fontSize * 1.4;
  const usableWidth = pageWidth - margin * 2;
  // Estimation largeur moyenne d'un caractère Helvetica ≈ 0.5 × taille.
  const maxChars = Math.floor(usableWidth / (fontSize * 0.5));

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  if (title) {
    page.drawText(title, { x: margin, y, size: titleSize, font: fontBold, color: rgb(0, 0, 0) });
    y -= titleSize * 1.8;
  }

  for (const line of wrapText(body, maxChars)) {
    if (y < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line) {
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= lineHeight;
  }

  return doc.save();
}

/** Génère un DOCX (titre en heading + paragraphes). */
export async function generateDocx(title: string, body: string): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun(line)],
          spacing: { after: 120 },
        })
    );

  const doc = new Document({
    sections: [
      {
        children: [
          ...(title
            ? [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 240 } })]
            : []),
          ...paragraphs,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
