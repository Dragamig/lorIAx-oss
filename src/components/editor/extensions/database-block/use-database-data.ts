import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { DbData, DbColumn, DbRow, DbListItem, ColumnType, ColumnConfig, CellValue, SortConfig, FilterGroup } from "./types";
import { normalizeFilterTree, countActiveConditions, emptyTree, applySortAndFilter, type FilterContext } from "./filter-tree";
import { useRelationData } from "./use-relation-data";
import { toDisplayPatch, type DisplayConfig } from "@/lib/bases/view-config";
import { createLatestGate } from "@/lib/bases/latest-wins";
import { fetchJson, apiPost, apiPatch, apiDelete, ApiError } from "./api";

export type AddColumnResult = { ok: true } | { ok: false; code?: string };

type CreatedColumn = DbColumn & { inverseColumn?: DbColumn | null };

// ─── Custom Hook: useDatabaseData ────────────────────────────────────────────

export interface ViewPersistence {
  // Vue serveur (page /bases) : tri/filtre persistés dans userDatabaseViews.config.
  viewId?: string;
  initialSorts?: SortConfig[];
  // Accepte l'ancien format plat (FilterConfig[]) ou l'arbre récursif persisté ;
  // normalizeFilterTree gère la migration vers FilterGroup.
  initialFilters?: unknown;
  // Affichage de la vue (menu Colonnes, hauteur de ligne). Persisté avec
  // sorts/filters dans le même PATCH ; ignoré par la persistance « base liée ».
  initialDisplay?: DisplayConfig;
  // Intégration « base liée » : persistance du tri/filtre dans le nœud TipTap
  // (propre au document, sans toucher la base source). Doit être stable.
  onChange?: (config: { sorts: SortConfig[]; filters: FilterGroup }) => void;
}

export function useDatabaseData(
  data: DbData,
  spaceId: string,
  onRefresh: () => void,
  viewPersistence?: ViewPersistence,
  options?: {
    /** Écrivant partagé (fiche latérale) : remplace le PATCH direct et gère son propre toast d'échec. */
    writeCell?: (rowId: string, columnId: string, value: CellValue) => Promise<boolean>;
    /** Quand fourni, l'état optimiste local n'est réinitialisé que si cette valeur change (et non à chaque data.rows). */
    resetKey?: unknown;
    /** Contexte des filtres relatifs (est moi, ce trimestre) : utilisateur, fuseau, instant. */
    evalContext?: FilterContext;
  },
) {
  const [localCells, setLocalCells] = useState<Record<string, Record<string, CellValue>>>({});
  const { columns } = data;
  // Lignes optimistes (suppression, duplication, déplacement) : remplacent
  // data.rows jusqu'au prochain rafraîchissement serveur.
  const [rowsOverride, setRowsOverride] = useState<DbRow[] | null>(null);
  // Shared writer mode: data.rows carries the live cells (grid and sheet writes), so the override only
  // keeps its order and membership and takes cells from data.rows by id. Document block path unchanged.
  const sharedMode = options?.writeCell !== undefined;
  const baseRows = useMemo(() => {
    if (!rowsOverride) return data.rows;
    if (!sharedMode) return rowsOverride;
    const current = new Map(data.rows.map((r) => [r.id, r]));
    return rowsOverride.map((r) => {
      const live = current.get(r.id);
      return live && live.cells !== r.cells ? { ...r, cells: live.cells } : r;
    });
  }, [rowsOverride, data.rows, sharedMode]);
  const rows = useMemo(() => baseRows.map((row) => {
    const overrides = localCells[row.id];
    if (!overrides) return row;
    return { ...row, cells: { ...row.cells, ...overrides } };
  }), [baseRows, localCells]);

  const resetToken = options?.resetKey ?? data.rows;
  useEffect(() => { setLocalCells({}); setRowsOverride(null); }, [resetToken]);
  const sharedWriteCell = options?.writeCell;
  const evalContext = options?.evalContext;

  const mutateRows = useCallback(
    (fn: (rows: DbRow[]) => DbRow[]) => setRowsOverride((prev) => fn(prev ?? data.rows)),
    [data.rows],
  );

  // Incrémenté après toute écriture de colonne : force le rechargement des bases
  // cibles (la jumelle a pu être créée, renommée ou supprimée côté cible).
  const [relationReload, setRelationReload] = useState(0);
  const [allDatabases, setAllDatabases] = useState<DbListItem[]>([]);
  const [sorts, setSorts] = useState<SortConfig[]>(viewPersistence?.initialSorts ?? []);
  const [filterTree, setFilterTree] = useState<FilterGroup>(() =>
    normalizeFilterTree(viewPersistence?.initialFilters),
  );
  const [displayConfig, setDisplayConfig] = useState<DisplayConfig>(
    () => viewPersistence?.initialDisplay ?? {},
  );
  const [showFilters, setShowFilters] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Persistance par vue : debounced PATCH des sorts/filters dans view.config.
  // Le 1er render est ignoré (hydratation initiale = pas de changement utilisateur).
  const persistViewId = viewPersistence?.viewId;
  // onChange via ref : son identité (closure sur updateAttributes du nœud) peut
  // changer à chaque render. On la garde hors des deps de l'effet pour éviter
  // de re-déclencher la persistance en boucle (l'effet ne doit réagir qu'aux
  // changements réels de tri/filtre).
  const onConfigChangeRef = useRef(viewPersistence?.onChange);
  // Mise à jour de la ref hors render (React Compiler interdit la mutation de
  // ref.current pendant le render). L'effet persistance lit la ref dans un
  // setTimeout(500ms), donc la valeur sera toujours à jour au moment du fire.
  useEffect(() => {
    onConfigChangeRef.current = viewPersistence?.onChange;
  });
  const hydratedRef = useRef(false);
  const linkedHydratedRef = useRef(false);
  const displayRef = useRef(displayConfig);
  const savedDisplayRef = useRef(displayConfig);
  const skipRef = useRef(false);
  const gateRef = useRef(createLatestGate());
  const pendingSendRef = useRef<(() => void) | null>(null);

  // Linked block: sorts/filters only, never re-fired by display changes.
  const hasLinkedOnChange = !!viewPersistence?.onChange;
  useEffect(() => {
    if (persistViewId || !hasLinkedOnChange) return;
    if (!linkedHydratedRef.current) {
      linkedHydratedRef.current = true;
      return;
    }
    const handle = setTimeout(() => onConfigChangeRef.current?.({ sorts, filters: filterTree }), 500);
    return () => clearTimeout(handle);
  }, [sorts, filterTree, persistViewId, hasLinkedOnChange]);

  useEffect(() => {
    displayRef.current = displayConfig;
    if (!persistViewId) return;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      savedDisplayRef.current = displayConfig;
      return;
    }
    // Rollback of the display state: nothing new to save.
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const sent = displayConfig;
    const send = () => {
      pendingSendRef.current = null;
      const token = gateRef.current.next("view");
      apiPatch(`/api/databases/${data.id}/views/${persistViewId}`, {
        config: { sorts, filters: filterTree, ...toDisplayPatch(sent) },
      })
        .then(() => {
          savedDisplayRef.current = sent;
        })
        .catch(() => {
          if (!gateRef.current.isLatest("view", token)) return;
          if (displayRef.current !== savedDisplayRef.current) {
            skipRef.current = true;
            setDisplayConfig(savedDisplayRef.current);
          }
          toast.error("Impossible d'enregistrer la configuration de la vue");
        });
    };
    pendingSendRef.current = send;
    const handle = setTimeout(send, 500);
    return () => clearTimeout(handle);
  }, [sorts, filterTree, displayConfig, persistViewId, data.id]);

  // Unmount with a debounced save still pending: send it now instead of losing it.
  useEffect(() => () => pendingSendRef.current?.(), []);

  // Fetch all databases in this space (for relation config)
  useEffect(() => {
    if (!spaceId) return;
    fetchJson<DbListItem[]>(`/api/databases?spaceId=${spaceId}`)
      .then(setAllDatabases)
      .catch(() => setAllDatabases([]));
  }, [spaceId]);

  // Lignes et colonnes des bases cibles des relations
  const relationData = useRelationData(columns, relationReload);

  const updateCell = useCallback(
    async (rowId: string, columnId: string, value: CellValue) => {
      // Écrivant partagé : son état optimiste (useRowWrites) alimente déjà data.rows, aucune couche locale.
      if (sharedWriteCell) {
        await sharedWriteCell(rowId, columnId, value);
        return;
      }
      // Mise à jour optimiste : on mémorise l'override précédent pour pouvoir
      // revenir en arrière proprement si l'écriture serveur échoue.
      let hadPrevious = false;
      let previous: CellValue | undefined;
      setLocalCells((prev) => {
        const rowOverrides = prev[rowId] ?? {};
        hadPrevious = columnId in rowOverrides;
        previous = rowOverrides[columnId];
        return { ...prev, [rowId]: { ...rowOverrides, [columnId]: value } };
      });
      try {
        await apiPatch(`/api/databases/${data.id}/rows`, {
          rows: [{ id: rowId, cells: { [columnId]: value } }],
        });
      } catch {
        // Rollback de l'override optimiste + signalement à l'usager.
        setLocalCells((prev) => {
          const rowOverrides = { ...(prev[rowId] ?? {}) };
          if (hadPrevious) rowOverrides[columnId] = previous as CellValue;
          else delete rowOverrides[columnId];
          return { ...prev, [rowId]: rowOverrides };
        });
        toast.error("Échec de l'enregistrement de la cellule");
      }
    },
    [data.id, sharedWriteCell]
  );

  const addRow = useCallback(async () => {
    try {
      await apiPost(`/api/databases/${data.id}/rows`, { cells: {} });
      onRefresh();
    } catch {
      toast.error("Échec de l'ajout de la ligne");
    }
  }, [data.id, onRefresh]);

  const addColumn = useCallback(
    async (
      name: string,
      type: ColumnType,
      config?: ColumnConfig,
      relationOptions?: { createInverse: boolean; inverseName?: string },
    ): Promise<AddColumnResult> => {
      const body: Record<string, unknown> = { name, type, config };
      if (type === "relation" && relationOptions) {
        body.createInverse = relationOptions.createInverse;
        if (relationOptions.createInverse && relationOptions.inverseName) {
          body.inverseName = relationOptions.inverseName;
        }
      }
      try {
        const created = await apiPost<CreatedColumn>(`/api/databases/${data.id}/columns`, body);
        onRefresh();
        setRelationReload((n) => n + 1);
        const inverse = created.inverseColumn;
        if (inverse) {
          const targetId = inverse.databaseId;
          const targetName = allDatabases.find((d) => d.id === targetId)?.name ?? "la base cible";
          toast.success(`Colonne « ${created.name} » créée, inverse « ${inverse.name} » créée dans ${targetName}`, {
            action: {
              label: "Voir",
              onClick: () => {
                const qs = spaceId ? `?spaceId=${spaceId}` : "";
                window.open(`/bases/${targetId}${qs}`, "_blank", "noopener");
              },
            },
            cancel: {
              label: "Annuler",
              onClick: async () => {
                try {
                  await apiDelete(`/api/databases/${data.id}/columns`, {
                    columnId: created.id,
                    alsoDeleteInverse: true,
                  });
                  onRefresh();
                  setRelationReload((n) => n + 1);
                  toast.success("Création annulée");
                } catch {
                  toast.error("Impossible d'annuler la création");
                }
              },
            },
          });
        } else {
          toast.success(`Colonne « ${created.name} » créée`);
        }
        return { ok: true };
      } catch (e) {
        const code = e instanceof ApiError ? e.code : undefined;
        // Conflit de nom côté cible : affiché en ligne dans le formulaire, pas en toast.
        if (code !== "inverse-name-exists") toast.error("Échec de l'ajout de la colonne");
        return { ok: false, code };
      }
    },
    [data.id, onRefresh, allDatabases, spaceId]
  );

  const updateColumn = useCallback(
    async (columnId: string, updates: Partial<DbColumn>) => {
      try {
        await apiPatch(`/api/databases/${data.id}/columns`, {
          columns: [{ id: columnId, ...updates }],
        });
        onRefresh();
        setRelationReload((n) => n + 1);
      } catch (e) {
        if (e instanceof ApiError && e.code === "paired-target-locked") {
          toast.error("La base cible d'une relation jumelée ne peut pas être modifiée");
        } else {
          toast.error("Échec de la modification de la colonne");
        }
      }
    },
    [data.id, onRefresh]
  );

  const deleteColumn = useCallback(
    async (columnId: string, alsoDeleteInverse = false) => {
      try {
        const body: Record<string, unknown> = { columnId };
        if (alsoDeleteInverse) body.alsoDeleteInverse = true;
        const res = await apiDelete<{ ok: boolean; deletedInverseColumnId?: string | null }>(
          `/api/databases/${data.id}/columns`,
          body,
        );
        onRefresh();
        setRelationReload((n) => n + 1);
        toast.success(res?.deletedInverseColumnId ? "Colonne et jumelle supprimées" : "Colonne supprimée");
      } catch {
        toast.error("Échec de la suppression de la colonne");
      }
    },
    [data.id, onRefresh]
  );

  // Cycle d'un classement pour une colonne donnée :
  //   absent → ajout en asc (priorité la plus basse)
  //   asc    → bascule en desc
  //   desc   → suppression
  // Permet de cumuler plusieurs colonnes en cliquant sur leurs en-têtes.
  function toggleSort(columnId: string) {
    setSorts((prev) => {
      const existing = prev.find((s) => s.columnId === columnId);
      if (!existing) return [...prev, { columnId, direction: "asc" }];
      if (existing.direction === "asc") {
        return prev.map((s) => (s.columnId === columnId ? { ...s, direction: "desc" } : s));
      }
      return prev.filter((s) => s.columnId !== columnId);
    });
  }

  function addSort(columnId: string) {
    setSorts((prev) => {
      if (prev.some((s) => s.columnId === columnId)) return prev;
      return [...prev, { columnId, direction: "asc" }];
    });
  }

  function updateSort(index: number, patch: Partial<SortConfig>) {
    setSorts((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSort(index: number) {
    setSorts((prev) => prev.filter((_, i) => i !== index));
  }

  function moveSort(index: number, direction: -1 | 1) {
    setSorts((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // Réinitialise l'arbre de filtres (bouton « Tout effacer »).
  const clearFilters = useCallback(() => setFilterTree(emptyTree()), []);

  const filteredRows = useMemo(
    () => applySortAndFilter(rows, columns, sorts, filterTree, evalContext),
    [rows, columns, sorts, filterTree, evalContext]
  );

  // Compteur de conditions actives pour le badge du bouton « Filtrer ».
  const activeFilterCount = useMemo(() => countActiveConditions(filterTree), [filterTree]);

  return {
    columns,
    rows,
    allDatabases,
    relationData,
    sorts,
    setSorts,
    displayConfig,
    setDisplayConfig,
    displayPersisted: !!persistViewId,
    addSort,
    updateSort,
    removeSort,
    moveSort,
    filterTree,
    setFilterTree,
    clearFilters,
    activeFilterCount,
    showFilters,
    setShowFilters,
    showImport,
    setShowImport,
    updateCell,
    addRow,
    baseRows,
    mutateRows,
    setRowsOverride,
    addColumn,
    updateColumn,
    deleteColumn,
    toggleSort,
    filteredRows,
  };
}
