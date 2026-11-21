"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { X, Table2, Loader2, Download, BarChart2, LineChart, PieChart, AreaChart } from "lucide-react";
import dynamic from "next/dynamic";
import { toast } from "sonner";

const ChartRenderer = dynamic(() => import("./chart-renderer"), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────

type ChartType = "bar" | "line" | "pie" | "area";

interface ChartDataRow {
  [key: string]: string | number;
}

interface SpreadsheetModalProps {
  sheetId: string;
  /** Espace de rattachement — requis par l'API à la création du tableur. */
  spaceId?: string;
  title: string;
  initialChartRange?: string;
  initialChartType?: string;
  onClose: (stats?: { rowCount: number; colCount: number; chartRange?: string; chartType?: string }) => void;
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function colLetterToIndex(letters: string): number {
  return letters.toUpperCase().split("").reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function parseRange(range: string): { startRow: number; endRow: number; startCol: number; endCol: number } | null {
  const m = range.trim().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;
  return {
    startCol: colLetterToIndex(m[1]),
    startRow: parseInt(m[2]) - 1,
    endCol: colLetterToIndex(m[3]),
    endRow: parseInt(m[4]) - 1,
  };
}

function extractChartData(
  snapshot: Record<string, unknown> | null,
  range: string
): { data: ChartDataRow[]; columns: string[]; labelKey: string } | null {
  if (!snapshot?.sheets) return null;
  const parsed = parseRange(range);
  if (!parsed) return null;

  const { startRow, endRow, startCol, endCol } = parsed;
  if (endRow <= startRow || endCol < startCol) return null;

  // Première feuille active
  const sheet = Object.values(snapshot.sheets as Record<string, unknown>)[0] as Record<string, unknown>;
  const cellData = (sheet?.cellData ?? {}) as Record<number, Record<number, { v?: unknown }>>;

  const getCellValue = (r: number, c: number): string | number => {
    const v = cellData[r]?.[c]?.v;
    if (v === null || v === undefined) return "";
    return typeof v === "number" ? v : String(v);
  };

  // Première ligne = en-têtes
  const headers: string[] = [];
  for (let c = startCol; c <= endCol; c++) {
    const val = getCellValue(startRow, c);
    headers.push(String(val) || `Col${c - startCol + 1}`);
  }

  // Lignes de données
  const rows: ChartDataRow[] = [];
  for (let r = startRow + 1; r <= endRow; r++) {
    const row: ChartDataRow = {};
    for (let c = startCol; c <= endCol; c++) {
      row[headers[c - startCol]] = getCellValue(r, c);
    }
    rows.push(row);
  }

  if (rows.length === 0) return null;

  return { data: rows, columns: headers, labelKey: headers[0] };
}

// ─── Données par défaut ──────────────────────────────────────────────────────

function defaultWorkbookData(sheetId: string) {
  return {
    id: sheetId,
    name: "Classeur",
    appVersion: "0.2.0",
    locale: "fr-FR",
    styles: {},
    sheetOrder: [sheetId + "_sheet1"],
    sheets: {
      [sheetId + "_sheet1"]: {
        id: sheetId + "_sheet1",
        name: "Feuille 1",
        cellData: {},
        rowCount: 30,
        columnCount: 20,
        defaultColumnWidth: 100,
        defaultRowHeight: 24,
        defaultStyle: { ff: "Arial", fs: 10 },
      },
    },
  };
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function SpreadsheetModal({ sheetId, spaceId, title, initialChartRange, initialChartType, onClose }: SpreadsheetModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const univerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workbookDataRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"data" | "chart">("data");

  // État graphique
  const [chartRange, setChartRange] = useState(initialChartRange || "A1:D10");
  const [chartType, setChartType] = useState<ChartType>((initialChartType as ChartType) || "bar");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null);

  // ─── Chargement ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/spreadsheet/${sheetId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        workbookDataRef.current =
          body.data && typeof body.data === "object" && !Array.isArray(body.data)
            ? body.data
            : defaultWorkbookData(sheetId);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          workbookDataRef.current = defaultWorkbookData(sheetId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [sheetId]);

  // ─── Initialisation Univer ─────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !containerRef.current || !workbookDataRef.current) return;
    let disposed = false;

    (async () => {
      const [
        { LocaleType, mergeLocales },
        { createUniver },
        { UniverSheetsCorePreset },
        { default: frFR },
        { UniverSheetsDataValidationPreset },
        { default: frFRValidation },
      ] = await Promise.all([
        import("@univerjs/core"),
        import("@/lib/univer/create-univer"),
        import("@univerjs/preset-sheets-core"),
        import("@univerjs/preset-sheets-core/locales/fr-FR"),
        import("@univerjs/preset-sheets-data-validation"),
        import("@univerjs/preset-sheets-data-validation/locales/fr-FR"),
      ]);
      await import("@univerjs/preset-sheets-core/lib/index.css");
      await import("@univerjs/preset-sheets-data-validation/lib/index.css");

      if (disposed || !containerRef.current) return;

      const { univerAPI } = createUniver({
        locale: LocaleType.FR_FR,
        locales: { [LocaleType.FR_FR]: mergeLocales(frFR, frFRValidation) },
        presets: [
          UniverSheetsCorePreset({ container: containerRef.current }),
          UniverSheetsDataValidationPreset(),
        ],
      });

      univerAPI.createWorkbook(workbookDataRef.current);
      univerRef.current = univerAPI;
    })();

    return () => {
      disposed = true;
      univerRef.current?.dispose();
      univerRef.current = null;
    };
  }, [loading]);

  // ─── Snapshot pour le graphique ────────────────────────────────────────────
  const refreshSnapshot = useCallback(() => {
    const snap = univerRef.current?.getActiveWorkbook()?.save() ?? null;
    setSnapshot(snap);
  }, []);

  // Rafraîchir le snapshot quand on bascule sur l'onglet graphique
  useEffect(() => {
    if (activeTab === "chart") refreshSnapshot();
  }, [activeTab, refreshSnapshot]);

  // ─── Données graphique calculées ───────────────────────────────────────────
  const chartData = useMemo(() => {
    return extractChartData(snapshot, chartRange);
  }, [snapshot, chartRange]);

  // ─── Sauvegarde ────────────────────────────────────────────────────────────
  const getSnapshot = useCallback(() => {
    return univerRef.current?.getActiveWorkbook()?.save() ?? null;
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const snap = getSnapshot();
      if (!snap) return;
      fetch(`/api/spreadsheet/${sheetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: snap, spaceId }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sheetId, spaceId, getSnapshot]);

  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // Enregistrer d'abord pour exporter l'état courant.
      const snap = getSnapshot();
      if (snap) {
        const put = await fetch(`/api/spreadsheet/${sheetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: snap, spaceId }),
        });
        if (!put.ok) throw new Error("save");
      }
      const res = await fetch(`/api/spreadsheet/${sheetId}/export?name=${encodeURIComponent(title || "tableur")}`);
      if (!res.ok) throw new Error("export");
      const blob = await res.blob();
      const fileName = `${(title || "tableur").replace(/[/\\?%*:|"<>]/g, "-")}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Export prêt : ${fileName}`);
    } catch {
      toast.error("Échec de l'export .xlsx");
    } finally {
      setExporting(false);
    }
  }, [sheetId, spaceId, title, getSnapshot]);

  const handleClose = useCallback(async () => {
    setSaving(true);
    const snap = getSnapshot();

    if (snap) {
      try {
        await fetch(`/api/spreadsheet/${sheetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: snap, spaceId }),
        });
      } catch { /* fermeture même en cas d'erreur réseau */ }
    }

    let maxRow = 0, maxCol = 0;
    if (snap?.sheets) {
      for (const sheet of Object.values(snap.sheets) as Record<string, unknown>[]) {
        const cellData = (sheet as Record<string, unknown> | undefined)?.cellData;
        if (!cellData || typeof cellData !== 'object') {
          continue;
        }
        for (const [r, row] of Object.entries(cellData as Record<string, Record<string, { v?: unknown }>>)) {
          for (const [c, cell] of Object.entries(row as Record<string, { v?: unknown }>)) {
            if ((cell as { v?: unknown })?.v !== null && (cell as { v?: unknown })?.v !== undefined) {
              maxRow = Math.max(maxRow, Number(r) + 1);
              maxCol = Math.max(maxCol, Number(c) + 1);
            }
          }
        }
      }
    }

    setSaving(false);
    onClose(maxRow > 0 ? { rowCount: maxRow, colCount: maxCol, chartRange, chartType } : undefined);
  }, [sheetId, spaceId, onClose, getSnapshot, chartRange, chartType]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleClose]);

  // ─── Rendu ─────────────────────────────────────────────────────────────────

  const CHART_TYPES: { type: ChartType; icon: React.ReactNode; label: string }[] = [
    { type: "bar",  icon: <BarChart2 className="h-4 w-4" />,  label: "Barres" },
    { type: "line", icon: <LineChart className="h-4 w-4" />,  label: "Courbe" },
    { type: "area", icon: <AreaChart className="h-4 w-4" />,  label: "Aire" },
    { type: "pie",  icon: <PieChart className="h-4 w-4" />,   label: "Camembert" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" role="dialog" aria-modal="true" aria-label={title || "Tableur"}>
      {/* Barre supérieure */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Table2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400">Tableur</span>
            <span className="text-xs text-muted-foreground">—</span>
            <span className="text-sm text-foreground">{title}</span>
          </div>
          {/* Onglets */}
          <div className="flex items-center gap-0.5 ml-4 bg-muted rounded-md p-0.5">
            <button
              onClick={() => setActiveTab("data")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === "data"
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Données
            </button>
            <button
              onClick={() => setActiveTab("chart")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === "chart"
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Graphique
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title={loading ? "Chargement du tableur en cours" : "Exporter en .xlsx"}
          aria-label="Exporter en .xlsx"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Exporter en .xlsx
        </button>
        <button
          onClick={handleClose}
          disabled={saving}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Fermer et sauvegarder (Échap)"
          aria-label="Fermer et sauvegarder le tableur"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </button>
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Tableur Univer — toujours monté pour garder l'état */}
        <div
          ref={containerRef}
          className="w-full h-full"
          style={{ display: activeTab === "data" ? "block" : "none" }}
        />

        {/* Onglet Graphique */}
        {activeTab === "chart" && (
          <div className="w-full h-full flex flex-col overflow-auto p-6 gap-6">
            {/* Contrôles */}
            <div className="flex flex-wrap items-end gap-6">
              {/* Plage */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Plage de données
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chartRange}
                    onChange={(e) => setChartRange(e.target.value)}
                    onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="ex : A1:D10"
                    className="w-36 px-2.5 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                  <button
                    onClick={refreshSnapshot}
                    className="px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Actualiser
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  La 1ʳᵉ ligne doit contenir les en-têtes
                </p>
              </div>

              {/* Type de graphique */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Type de graphique
                </label>
                <div className="flex items-center gap-1">
                  {CHART_TYPES.map(({ type, icon, label }) => (
                    <button
                      key={type}
                      onClick={() => setChartType(type)}
                      title={label}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                        chartType === type
                          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 font-medium"
                          : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      {icon}
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Graphique */}
            <div className="flex-1 min-h-0">
              {chartData ? (
                <ChartRenderer
                  config={{
                    chartType,
                    title,
                    data: chartData.data,
                    columns: chartData.columns,
                    labelKey: chartData.labelKey,
                    colors: [],
                  }}
                  chartRef={{ current: null }}
                />
              ) : (
                <div className="h-64 flex flex-col items-center justify-center gap-3 text-muted-foreground/50 border-2 border-dashed border-border rounded-lg">
                  <BarChart2 className="h-10 w-10" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Aucune donnée à afficher</p>
                    <p className="text-xs mt-1">
                      Saisissez une plage valide (ex : A1:D10) avec des en-têtes en première ligne
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
