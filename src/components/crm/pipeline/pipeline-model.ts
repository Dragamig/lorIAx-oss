import {
  boardTotals,
  groupRowsIntoLanes,
  laneTotals,
  resolveTotalsConfig,
  valueForMove,
  type ActiveTotalsConfig,
  type KanbanColumnLike,
  type KanbanLane,
} from "@/lib/bases/kanban";
import { filterDeals, isLate } from "@/lib/crm/deal-model";
import type { PipelineDeal, PipelineDto } from "@/lib/crm/pipeline";

export interface BoardCard {
  id: string;
  title: string;
  contactName: string | null;
  amount: number | null;
  relance: string | null;
  late: boolean;
  ownerInitials: string;
}

export interface BoardLane {
  key: string;
  label: string;
  cards: BoardCard[];
  totals: ReturnType<typeof laneTotals> | null;
  closed: boolean;
  weight: number | null;
}

export interface Board {
  lanes: BoardLane[];
  banner: ReturnType<typeof boardTotals> | null;
  visibleIds: string[];
}

export interface BoardLocalFilters {
  mine: boolean;
  late: boolean;
  ownerId: string | null;
  weighted: boolean;
}

function statusColumn(dto: PipelineDto): KanbanColumnLike {
  const col = dto.columns.find((c) => c.id === dto.statusColumnId);
  return col ?? { id: dto.statusColumnId ?? "", name: "", type: "select", config: {} };
}

/** Voie d'un dossier : son statut s'il figure parmi les voies, sinon la voie vide (aucun dossier ne disparaît). */
function laneOf(dto: PipelineDto, status: string | null): string {
  return status !== null && status !== "" && dto.lanes.some((l) => l.key === status) ? status : "";
}

function activeTotals(dto: PipelineDto): ActiveTotalsConfig | null {
  if (!dto.totals) return null;
  return resolveTotalsConfig(dto.columns, { kanbanTotals: dto.totals }).active;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? "")
    .join("");
}

export function buildBoard(
  dto: PipelineDto,
  local: BoardLocalFilters,
  userId: string,
  today: string,
  emptyLabel?: string,
): Board {
  const cfg = activeTotals(dto);
  const closedList = dto.totals?.closedLanes ?? [];
  // Filtres avant totaux : le bandeau reflète ce qui est affiché.
  const kept = new Set(
    filterDeals(dto.deals, {
      mine: local.mine && dto.mineAvailable ? { userId } : null,
      late: local.late,
      ownerId: local.ownerId,
      closed: closedList,
      today,
    }).map((d) => d.id),
  );
  const visible = dto.deals.filter((d) => kept.has(d.id));
  const base = statusColumn(dto);
  const column: KanbanColumnLike = {
    ...base,
    config: { ...(base.config ?? {}), options: dto.lanes.map((l) => l.key).filter((k) => k !== "") },
  };
  const rows = visible.map((d) => ({
    ...d,
    cells: { ...d.cells, [dto.statusColumnId ?? ""]: laneOf(dto, d.status) || null },
  }));
  const grouped = groupRowsIntoLanes(column, rows) as KanbanLane<PipelineDeal>[];
  const byId = new Map(visible.map((d) => [d.id, d]));
  const ownerName = new Map(dto.owners.map((o) => [o.id, o.name]));

  const lanes: BoardLane[] = grouped.map((g) => {
    const meta = dto.lanes.find((l) => l.key === g.key);
    const label = g.key === "" && emptyLabel !== undefined ? emptyLabel : (meta?.label ?? g.key);
    const cards: BoardCard[] = g.rows.map((r) => {
      const d = byId.get(r.id) as PipelineDeal;
      const first = d.ownerIds[0];
      return {
        id: d.id,
        title: d.title,
        contactName: d.contactName,
        amount: d.amount,
        relance: d.relance,
        late: isLate(d, closedList, today),
        ownerInitials: first !== undefined && ownerName.has(first) ? initialsOf(ownerName.get(first) as string) : "",
      };
    });
    const weightRaw = cfg && Object.prototype.hasOwnProperty.call(cfg.weights, g.key) ? cfg.weights[g.key] : 0;
    return {
      key: g.key,
      label,
      cards,
      totals: cfg ? laneTotals(g, cfg) : null,
      closed: cfg !== null && g.key !== "" && cfg.closedLanes.includes(g.key),
      weight: cfg && local.weighted ? weightRaw : null,
    };
  });

  return {
    lanes,
    banner: cfg ? boardTotals(grouped, cfg) : null,
    visibleIds: visible.map((d) => d.id),
  };
}

/** Mise à jour optimiste : ne touche que la cellule Statut (et le statut dérivé) du dossier. */
export function moveCard(dto: PipelineDto, dealId: string, laneKey: string): PipelineDto {
  const column = statusColumn(dto);
  const statusColumnId = dto.statusColumnId;
  if (statusColumnId === null) return dto; // Statut non raccordé : aucun déplacement
  const target = dto.deals.find((d) => d.id === dealId);
  if (!target) return dto;
  const from = laneOf(dto, target.status);
  const value = valueForMove(column, target.cells[statusColumnId], from, laneKey);
  if (value === undefined) return dto;
  const status = laneKey === "" ? null : laneKey;
  return {
    ...dto,
    deals: dto.deals.map((d) =>
      d.id === dealId ? { ...d, status, cells: { ...d.cells, [statusColumnId]: value } } : d,
    ),
  };
}

export function statusPatchFor(dto: PipelineDto, laneKey: string): { columnId: string | null; value: string | null } {
  return { columnId: dto.statusColumnId, value: laneKey === "" ? null : laneKey };
}
