import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, asc } from "drizzle-orm";
import {
  userDatabases,
  userDatabaseColumns,
  userDatabaseRows,
} from "@/lib/db/schema";
import { getVisibleView } from "@/lib/databases/view-access";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import {
  renderCsv,
  formatValue,
  sanitizeFilename,
  type ExportColumn,
  type ExportRow,
} from "@/lib/bases/export-encoders";
import {
  applySortAndFilter,
  normalizeFilterTree,
} from "@/components/editor/extensions/database-block/filter-tree";
import { resolveServerTz } from "@/lib/bases/tz-date";
import type {
  CellValue,
  ColumnConfig,
  ColumnType,
  DbColumn,
  DbRow,
  SortConfig,
} from "@/components/editor/extensions/database-block/types";

type RouteParams = { params: Promise<{ databaseId: string }> };

const MAX_ROWS = 100_000;
const SUPPORTED_FORMATS = ["csv", "xlsx"] as const;
type Format = (typeof SUPPORTED_FORMATS)[number];

/**
 * GET /api/databases/[id]/export?format=csv|xlsx[&viewId=…]
 *
 * Siloing via requireOrgScoped(database). Limite : 100 000 lignes.
 * Format ODS non supporté en MVP — XLSX ouvre nativement dans LibreOffice.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { databaseId } = await params;

  let ctx;
  try {
    ctx = await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const format = (request.nextUrl.searchParams.get("format") || "csv") as string;
  if (!SUPPORTED_FORMATS.includes(format as Format)) {
    if (format === "ods") {
      return NextResponse.json(
        {
          error:
            "ODS non encore disponible — utilisez XLSX (ouvert nativement par LibreOffice Calc).",
        },
        { status: 501 }
      );
    }
    return NextResponse.json(
      { error: `Format invalide. Supportés : ${SUPPORTED_FORMATS.join(", ")}` },
      { status: 400 }
    );
  }
  const viewId = request.nextUrl.searchParams.get("viewId");

  const [database, columns, rows] = await Promise.all([
    db.select().from(userDatabases).where(eq(userDatabases.id, databaseId)).limit(1).then((r) => r[0]),
    db
      .select()
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, databaseId))
      .orderBy(asc(userDatabaseColumns.position)),
    db
      .select()
      .from(userDatabaseRows)
      .where(eq(userDatabaseRows.databaseId, databaseId))
      .orderBy(asc(userDatabaseRows.position))
      .limit(MAX_ROWS + 1),
  ]);

  if (!database) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Export limité à ${MAX_ROWS} lignes (cette base en a plus)` },
      { status: 413 }
    );
  }

  // Lignes à exporter : par défaut toutes (ordre de position). Si une vue est
  // demandée, on applique son tri et son filtre persistés (view.config) — même
  // moteur pur que l'affichage côté éditeur, pour un export WYSIWYG.
  let rowsToExport = rows;
  if (viewId) {
    const v = await getVisibleView(db, databaseId, viewId, ctx.user.id);
    if (!v) {
      return NextResponse.json({ error: "Vue introuvable" }, { status: 404 });
    }

    const cfg = (v.config ?? {}) as { sorts?: SortConfig[]; filters?: unknown };
    const sorts = Array.isArray(cfg.sorts) ? cfg.sorts : [];
    const filterTree = normalizeFilterTree(cfg.filters);

    // Mapping vers les types purs du moteur (les colonnes jsonb DB sont typées
    // large). createdAt/updatedAt ne servent pas au tri/filtre : valeurs sûres.
    const viewColumns: DbColumn[] = columns.map((c) => ({
      id: c.id,
      databaseId: c.databaseId,
      name: c.name,
      type: c.type as ColumnType,
      position: c.position,
      config: (c.config ?? {}) as ColumnConfig,
      createdAt: "",
    }));
    const viewRows: DbRow[] = rows.map((r) => ({
      id: r.id,
      databaseId: r.databaseId,
      cells: (r.cells ?? {}) as Record<string, CellValue>,
      position: r.position,
      createdAt: "",
      updatedAt: "",
    }));

    const filtered = applySortAndFilter(viewRows, viewColumns, sorts, filterTree, {
      now: new Date(),
      userId: ctx.user.id,
      tz: resolveServerTz(request.nextUrl.searchParams.get("tz")),
    });
    // Réordonne/filtre les lignes DB d'origine selon le résultat du moteur.
    const byId = new Map(rows.map((r) => [r.id, r]));
    rowsToExport = filtered.map((r) => byId.get(r.id)!).filter(Boolean);
  }

  const fileName = sanitizeFilename(`${database.name}.${format}`);

  const exportCols: ExportColumn[] = columns.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    position: c.position,
  }));
  const exportRows: ExportRow[] = rowsToExport.map((r) => ({ cells: r.cells }));

  if (format === "csv") {
    const body = renderCsv(exportCols, exportRows);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // XLSX via exceljs (import dynamique)
  const buffer = await renderXlsx(database.name, exportCols, exportRows);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function renderXlsx(
  dbName: string,
  columns: ExportColumn[],
  rows: ExportRow[]
): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "LorIAx";
  wb.created = new Date();
  const ws = wb.addWorksheet(dbName.slice(0, 31) || "Données");

  ws.columns = columns.map((c) => ({
    header: c.name,
    key: c.id,
    width: Math.max(12, c.name.length + 2),
  }));
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const cells = (r.cells ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const col of columns) {
      const v = cells[col.id];
      if (col.type === "number" && typeof v === "string") {
        const n = parseFloat(v);
        data[col.id] = Number.isFinite(n) ? n : v;
      } else if (Array.isArray(v) || (v && typeof v === "object")) {
        data[col.id] = formatValue(v);
      } else {
        data[col.id] = v;
      }
    }
    ws.addRow(data);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
