/**
 * Crée un document d'espace (markdown git) contenant un bloc tableur dont les
 * données initiales sont le classeur de demande (feuilles Lignes et Exigences).
 *
 * Comme `createDocument`, suppose que l'appelant a déjà vérifié le droit
 * d'écriture sur l'espace. Cloisonnement : le tableur est écrit avec son
 * `spaceId` (sans lui il est illisible, fail-closed) et un parent éventuel doit
 * appartenir au même espace.
 *
 * Sérialisation du bloc : identique au rendu HTML de `SpreadsheetBlock`
 * (`div[data-type="spreadsheet-block"]`, attributs sheetId/title/rowCount/colCount).
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { documents, spreadsheetData } from "@/lib/db/schema";
import { createDocument, type CreateDocumentInput } from "./create-document";
import {
  buildDemandWorkbook,
  LINES_HEADERS,
  type DemandWorkbookInput,
} from "@/lib/spreadsheet/demand-workbook";

export class ParentDocumentNotFoundError extends Error {
  constructor(public readonly parentId: string) {
    super(`Document parent introuvable dans l'espace : ${parentId}`);
    this.name = "ParentDocumentNotFoundError";
  }
}

export interface CreateSpreadsheetDocumentInput extends Omit<CreateDocumentInput, "content"> {
  workbook?: DemandWorkbookInput;
  /** Titre affiché du bloc tableur (défaut : titre du document). */
  sheetTitle?: string;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function spreadsheetBlockMarkdown(
  sheetId: string,
  title: string,
  rowCount: number,
  colCount: number,
): string {
  return `<div data-type="spreadsheet-block" sheetid="${sheetId}" title="${escapeAttr(title)}" rowcount="${rowCount}" colcount="${colCount}"></div>\n`;
}

export async function createSpreadsheetDocument(input: CreateSpreadsheetDocumentInput) {
  const { workbook, sheetTitle, ...docInput } = input;

  if (docInput.parentId) {
    const [parent] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, docInput.parentId), eq(documents.spaceId, docInput.spaceId)))
      .limit(1);
    if (!parent) throw new ParentDocumentNotFoundError(docInput.parentId);
  }

  const sheetId = randomUUID();
  const data = buildDemandWorkbook(workbook);
  const lineCount = workbook?.lines?.length ?? 0;

  await db.insert(spreadsheetData).values({
    sheetId,
    spaceId: docInput.spaceId,
    data: JSON.stringify(data),
  });

  try {
    const document = await createDocument({
      ...docInput,
      content: spreadsheetBlockMarkdown(
        sheetId,
        sheetTitle ?? docInput.title,
        lineCount + 1,
        LINES_HEADERS.length,
      ),
    });
    return { document, sheetId };
  } catch (err) {
    await db.delete(spreadsheetData).where(eq(spreadsheetData.sheetId, sheetId));
    throw err;
  }
}
