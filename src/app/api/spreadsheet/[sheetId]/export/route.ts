import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { db } from "@/lib/db";
import { spreadsheetData } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import logger from "@/lib/logger";
import { fortuneSheetsToWorkbookData } from "@/lib/spreadsheet/fortune-to-univer";
import { workbookToXlsx } from "@/lib/spreadsheet/workbook-to-xlsx";
import { sanitizeFilename } from "@/lib/bases/export-encoders";

type Params = { params: Promise<{ sheetId: string }> };

/**
 * GET /api/spreadsheet/[sheetId]/export?name=…
 * Mêmes contrôles d'accès que GET /api/spreadsheet/[sheetId] (session, espace
 * de rattachement obligatoire, espace accessible dans l'org courante).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { sheetId } = await params;

  try {
    const [row] = await db
      .select({ data: spreadsheetData.data, spaceId: spreadsheetData.spaceId })
      .from(spreadsheetData)
      .where(eq(spreadsheetData.sheetId, sheetId))
      .limit(1);

    if (!row || !row.spaceId) {
      return NextResponse.json({ error: "Tableur introuvable" }, { status: 404 });
    }
    const accessible = await getAccessibleSpaceIds(user);
    if (!accessible.includes(row.spaceId)) {
      return NextResponse.json({ error: "Tableur introuvable" }, { status: 404 });
    }

    const parsed = JSON.parse(row.data);
    const workbook = Array.isArray(parsed) ? fortuneSheetsToWorkbookData(parsed) : parsed;
    const buffer = await workbookToXlsx(workbook);

    const base = sanitizeFilename(req.nextUrl.searchParams.get("name")?.trim() || "tableur");
    const fileName = `${base}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error({ err: error }, "[spreadsheet] export error");
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
