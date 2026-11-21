"use client";

import { Plus, X, FolderPlus } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { DbColumn, FilterCondition, FilterGroup, FilterNode, FilterOperator } from "./types";
import {
  FILTER_OPERATORS_BY_TYPE,
  FILTER_OPERATOR_LABELS,
  DEFAULT_FILTER_OPERATOR,
} from "./constants";
import {
  NO_VALUE_OPS,
  isFilterGroup,
  addCondition,
  addGroup,
  setConjunction,
  updateCondition,
  removeNode,
} from "./filter-tree";
import { stopMouse } from "../../utils/stop-mouse";

// Valide qu'une chaîne est un opérateur de filtre valide
const VALID_OPERATORS = new Set<FilterOperator>([
  "contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty",
  "eq", "neq", "lt", "gt", "lte", "gte",
  "is_checked", "is_not_checked",
  "is_before", "is_after", "is_on_or_before", "is_on_or_after",
  "is_today", "is_this_week", "is_this_month", "is_this_year",
  "is_within_days", "is_this_quarter", "is_me",
]);

export function isValidFilterOperator(value: unknown): value is FilterOperator {
  return typeof value === "string" && VALID_OPERATORS.has(value as FilterOperator);
}

// Profondeur maximale d'imbrication des groupes (racine = 0).
const MAX_DEPTH = 2;

type SetTree = Dispatch<SetStateAction<FilterGroup>>;

const selectCls =
  "text-xs h-7 px-1.5 rounded-md border border-input bg-background hover:bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

// ─── Préfixe de connecteur (Où / Et / Ou) ───────────────────────────────────
// Airtable : 1re ligne = « Où », 2e ligne = sélecteur Et/Ou pilotant tout le
// groupe, lignes suivantes = libellé en lecture seule.
function ConjunctionPrefix({
  group,
  index,
  setTree,
}: {
  group: FilterGroup;
  index: number;
  setTree: SetTree;
}) {
  if (index === 0) {
    return <span className="text-xs text-muted-foreground w-14 shrink-0 text-right pr-1">Où</span>;
  }
  if (index === 1) {
    return (
      <select
        value={group.conjunction}
        onChange={(e) => setTree((t) => setConjunction(t, group.id, e.target.value as "and" | "or"))}
        onMouseDown={stopMouse}
        className={`${selectCls} w-14 shrink-0`}
        aria-label="Connecteur logique du groupe"
      >
        <option value="and">Et</option>
        <option value="or">Ou</option>
      </select>
    );
  }
  return (
    <span className="text-xs text-muted-foreground w-14 shrink-0 text-right pr-1">
      {group.conjunction === "and" ? "Et" : "Ou"}
    </span>
  );
}

// ─── Ligne de condition « champ · opérateur · valeur » ──────────────────────
function ConditionRow({
  condition,
  columns,
  setTree,
  excludeOperators,
}: {
  condition: FilterCondition;
  columns: DbColumn[];
  setTree: SetTree;
  excludeOperators?: FilterOperator[];
}) {
  const col = columns.find((c) => c.id === condition.columnId) ?? columns[0];
  const ops = (col ? FILTER_OPERATORS_BY_TYPE[col.type] : []).filter(
    (op) => op === condition.operator || !excludeOperators?.includes(op),
  );
  const needsValue = !NO_VALUE_OPS.has(condition.operator);
  // « dans les N prochains jours » attend un nombre de jours, pas une date.
  const isDayCount = condition.operator === "is_within_days";
  const inputType = isDayCount
    ? "number"
    : col?.type === "number" || col?.type === "autonumber"
      ? "number"
      : col?.type === "date"
        ? "date"
        : col?.type === "time"
          ? "time"
          : "text";

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      {/* Champ */}
      <select
        value={condition.columnId}
        onChange={(e) => {
          const next = columns.find((c) => c.id === e.target.value);
          setTree((t) =>
            updateCondition(t, condition.id, {
              columnId: e.target.value,
              operator: next ? DEFAULT_FILTER_OPERATOR[next.type] : "contains",
            }),
          );
        }}
        onMouseDown={stopMouse}
        className={`${selectCls} min-w-28 max-w-40`}
        aria-label="Champ filtré"
      >
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {/* Opérateur */}
      <select
        value={condition.operator}
        onChange={(e) => {
          const nextOperator = e.target.value;
          if (isValidFilterOperator(nextOperator)) {
            setTree((t) => updateCondition(t, condition.id, { operator: nextOperator }));
          }
        }}
        onMouseDown={stopMouse}
        className={`${selectCls} min-w-24`}
        aria-label="Opérateur de filtre"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {FILTER_OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>

      {/* Valeur (masquée pour les opérateurs sans valeur) */}
      {needsValue ? (
        <input
          value={condition.value}
          onChange={(e) => setTree((t) => updateCondition(t, condition.id, { value: e.target.value }))}
          onMouseDown={stopMouse}
          type={inputType}
          placeholder={isDayCount ? "Nb de jours…" : "Valeur…"}
          className="text-xs h-7 px-2 rounded-md border border-input bg-background flex-1 min-w-20 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-label="Valeur du filtre"
        />
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}

// ─── Éditeur de groupe (récursif) ────────────────────────────────────────────
function GroupEditor({
  group,
  columns,
  setTree,
  depth,
  excludeOperators,
}: {
  group: FilterGroup;
  columns: DbColumn[];
  setTree: SetTree;
  depth: number;
  excludeOperators?: FilterOperator[];
}) {
  const isRoot = depth === 0;
  const canNest = depth < MAX_DEPTH;

  return (
    <div
      className={
        isRoot
          ? "flex flex-col gap-2"
          : "flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2"
      }
    >
      {group.children.length === 0 && isRoot && (
        <p className="text-xs text-muted-foreground px-1">Aucune condition de filtre.</p>
      )}

      {group.children.map((child: FilterNode, index) => (
        <div key={child.id} className="flex items-start gap-1.5">
          <div className="pt-1">
            <ConjunctionPrefix group={group} index={index} setTree={setTree} />
          </div>

          {isFilterGroup(child) ? (
            <div className="flex-1 min-w-0">
              <GroupEditor group={child} columns={columns} setTree={setTree} depth={depth + 1} excludeOperators={excludeOperators} />
            </div>
          ) : (
            <ConditionRow condition={child} columns={columns} setTree={setTree} excludeOperators={excludeOperators} />
          )}

          <button
            onClick={() => setTree((t) => removeNode(t, child.id))}
            onMouseDown={stopMouse}
            className="p-1 mt-0.5 rounded-md text-muted-foreground hover:bg-muted hover:text-destructive shrink-0"
            title="Supprimer"
            aria-label="Supprimer cette condition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {/* Actions d'ajout */}
      <div className="flex items-center gap-3 pl-14">
        <button
          onClick={() => setTree((t) => addCondition(t, group.id, columns))}
          onMouseDown={stopMouse}
          disabled={columns.length === 0}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter une condition
        </button>
        {canNest && (
          <button
            onClick={() => setTree((t) => addGroup(t, group.id, columns))}
            onMouseDown={stopMouse}
            disabled={columns.length === 0}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline"
          >
            <FolderPlus className="h-3.5 w-3.5" /> Ajouter un groupe de conditions
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Constructeur de filtres (contenu du popover) ────────────────────────────
export function FilterBuilder({
  tree,
  setTree,
  columns,
  onClear,
  excludeOperators,
}: {
  tree: FilterGroup;
  setTree: SetTree;
  columns: DbColumn[];
  onClear: () => void;
  // Opérateurs masqués du sélecteur (ex. is_me hors d'une vue utilisateur).
  excludeOperators?: FilterOperator[];
}) {
  const hasConditions = tree.children.length > 0;

  return (
    <div
      className="flex flex-col gap-3 w-[34rem] max-w-[calc(100vw-2rem)]"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {hasConditions ? "Afficher les lignes qui correspondent :" : "Aucun filtre appliqué"}
        </span>
        {hasConditions && (
          <button
            onClick={onClear}
            onMouseDown={stopMouse}
            className="text-xs text-destructive hover:underline"
          >
            Tout effacer
          </button>
        )}
      </div>

      <GroupEditor group={tree} columns={columns} setTree={setTree} depth={0} excludeOperators={excludeOperators} />
    </div>
  );
}
