"use client";

import {
  Upload,
  Download,
  Filter,
  ArrowUpDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ViewMode } from "./types";
import { VIEW_ICONS, VIEW_LABELS } from "./constants";
import { SyncConfigPanel } from "./sync-config-panel";
import type { DbData } from "./types";
import { exportCsv } from "./database-import-modal";

// ─── Database Toolbar ────────────────────────────────────────────────────────

export function DatabaseToolbar({
  data,
  viewMode,
  onViewModeChange,
  viewModeDisabledReasons,
  showFilters,
  onFiltersOpenChange,
  filtersCount,
  filterContent,
  showSort,
  onToggleSort,
  hasSort,
  onShowImport,
  onRefresh,
  fullscreen,
  onToggleFullscreen,
  displayControls,
  readOnly = false,
}: {
  data: DbData;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  // Raison de désactivation par mode (page Bases : aucune vue de ce type).
  viewModeDisabledReasons?: Partial<Record<ViewMode, string>>;
  showFilters: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  filtersCount: number;
  filterContent: React.ReactNode;
  showSort: boolean;
  onToggleSort: () => void;
  hasSort: boolean;
  onShowImport: () => void;
  onRefresh: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  // Menu Colonnes + hauteur de ligne (vue Tableau uniquement).
  displayControls?: React.ReactNode;
  // En lecture seule (base liée), on masque l'import CSV et la config de sync
  // externe (qui modifieraient la base source).
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30">
      {/* View mode selector */}
      <div className="flex items-center gap-0.5 mr-2">
        {(["table", "kanban", "gallery"] as ViewMode[]).map((mode) => {
          const disabledReason = viewModeDisabledReasons?.[mode];
          return (
            <Button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              variant={viewMode === mode ? "secondary" : "ghost"}
              size="xs"
              title={disabledReason ?? VIEW_LABELS[mode]}
              aria-label={disabledReason ?? VIEW_LABELS[mode]}
              disabled={!!disabledReason}
            >
              {VIEW_ICONS[mode]}
              <span className="hidden sm:inline">{VIEW_LABELS[mode]}</span>
            </Button>
          );
        })}
      </div>

      <div className="flex-1" />

      {displayControls}

      {/* Sort toggle */}
      <Button
        onClick={onToggleSort}
        variant={(showSort || hasSort) ? "secondary" : "ghost"}
        size="xs"
        title="Classer"
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Classer</span>
      </Button>

      {/* Filter popover — constructeur de conditions style Airtable */}
      <Popover open={showFilters} onOpenChange={onFiltersOpenChange}>
        <PopoverTrigger
          render={
            <Button
              variant={(showFilters || filtersCount > 0) ? "secondary" : "ghost"}
              size="xs"
              title="Filtrer"
            />
          }
        >
          <Filter className="h-3.5 w-3.5" />
          {filtersCount > 0 && <span>{filtersCount}</span>}
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="p-3">
          {filterContent}
        </PopoverContent>
      </Popover>

      {/* Import */}
      {!readOnly && (
        <Button
          onClick={onShowImport}
          variant="ghost"
          size="icon-sm"
          title="Importer CSV"
          aria-label="Importer un fichier CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      )}

      {/* Export */}
      <Button
        onClick={() => exportCsv(data)}
        variant="ghost"
        size="icon-sm"
        title="Exporter CSV"
        aria-label="Exporter en CSV"
      >
        <Upload className="h-3.5 w-3.5" />
      </Button>

      {/* Plein écran */}
      {onToggleFullscreen && (
        <Button
          onClick={onToggleFullscreen}
          variant="ghost"
          size="icon-sm"
          title={fullscreen ? "Quitter le plein écran" : "Plein écran"}
          aria-label={fullscreen ? "Quitter le plein écran" : "Afficher en plein écran"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      )}

      {/* Sync externe */}
      {!readOnly && (
        <div className="relative">
          <SyncConfigPanel databaseId={data.id} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}
