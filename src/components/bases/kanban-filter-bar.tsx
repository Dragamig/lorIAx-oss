"use client";

import { ArrowUpDown, Filter } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterBuilder } from "@/components/editor/extensions/database-block/filter-builder";
import { emptyTree } from "@/components/editor/extensions/database-block/filter-tree";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { DbColumn } from "@/components/editor/extensions/database-block/types";
import { SortPanel } from "./sort-panel";
import type { KanbanFilterSort } from "./use-kanban-filter-sort";

/** Boutons Filtrer et Trier du kanban : mêmes états et mêmes panneaux que la grille. */
export function KanbanFilterBar({
  columns,
  filter,
  readOnly,
}: {
  columns: DbColumn[];
  filter: KanbanFilterSort;
  readOnly: boolean;
}) {
  const t = useTranslations("basesTotals");
  const { sorts, setSorts, filterTree, setFilterTree, activeFilterCount } = filter;
  const filterLabel = readOnly ? t("readOnlyDisabled") : t("filterBarFilters");
  const sortLabel = readOnly ? t("readOnlyDisabled") : t("filterBarSorts");

  return (
    <div className="flex items-center gap-1" data-testid="kanban-filter-bar">
      <Popover>
        <Tip label={filterLabel}>
          <PopoverTrigger
            render={
              <Button
                variant={activeFilterCount > 0 ? "secondary" : "ghost"}
                size="xs"
                disabled={readOnly}
                focusableWhenDisabled
                className="disabled:pointer-events-auto"
                aria-label={t("filterBarFilters")}
              />
            }
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            <span>{t("filterBarFilters")}</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-foreground/10 px-1.5 text-[10px]" data-testid="kanban-filter-count">
                {activeFilterCount}
              </span>
            )}
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="end" sideOffset={6} className="p-3">
          <FilterBuilder
            tree={filterTree}
            setTree={setFilterTree}
            columns={columns}
            onClear={() => setFilterTree(emptyTree())}
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <Tip label={sortLabel}>
          <PopoverTrigger
            render={
              <Button
                variant={sorts.length > 0 ? "secondary" : "ghost"}
                size="xs"
                disabled={readOnly}
                focusableWhenDisabled
                className="disabled:pointer-events-auto"
                aria-label={t("filterBarSorts")}
              />
            }
          >
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
            <span>{t("filterBarSorts")}</span>
            {sorts.length > 0 && (
              <span className="rounded-full bg-foreground/10 px-1.5 text-[10px]">{sorts.length}</span>
            )}
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="end" sideOffset={6} className="p-3">
          <SortPanel
            sorts={sorts}
            setSorts={setSorts}
            columns={columns}
            className="flex flex-col gap-2 w-[22rem] max-w-[calc(100vw-2rem)]"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
