import { readAmount } from "@/lib/bases/kanban";
import { evaluateFormula } from "@/components/editor/extensions/database-block/formula-evaluator";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import type { ColumnDto, CrmContext, CrmRow } from "./context";
import type { CrmRole } from "./fields";
import { readIsoDate, relanceBucket } from "./dates";

export interface DealDto {
  id: string;
  title: string;
  status: string | null;
  amount: number | null;
  relance: string | null;
  closeDate: string | null;
  ownerIds: string[];
  contactId: string | null;
}

export interface ContactDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  org: string | null;
}

export interface InteractionDto {
  id: string;
  date: string | null;
  type: string | null;
  title: string | null;
  note: string | null;
  dealId: string | null;
}

type FieldColumn = (role: CrmRole, key: string) => string | null;

function cellOf(row: CrmRow, fieldColumn: FieldColumn, role: CrmRole, key: string): unknown {
  const col = fieldColumn(role, key);
  return col === null ? undefined : row.cells[col];
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Relation : premier identifiant d'un tableau de chaînes, sinon null. */
function firstId(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const first = v[0];
  return typeof first === "string" ? first : null;
}

/** Personne : tableau d'ids, ou chaîne scalaire héritée. */
function ids(v: unknown): string[] {
  if (typeof v === "string") return v === "" ? [] : [v];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x !== "");
}

/**
 * `amountOf` : évaluateur issu de `resolveTotalsConfig` (colonne montant de type formule, valeurs
 * jamais stockées). Sans lui, la cellule est lue telle quelle (nombre fini seulement).
 */
export function toDeal(
  row: CrmRow,
  fieldColumn: FieldColumn,
  amountOf?: (row: CrmRow) => unknown,
): DealDto {
  const cell = (key: string) => cellOf(row, fieldColumn, "dossiers", key);
  return {
    id: row.id,
    title: str(cell("titre")) ?? "",
    status: str(cell("statut")),
    amount: readAmount(amountOf ? amountOf(row) : cell("montant")),
    relance: readIsoDate(cell("relance")),
    closeDate: readIsoDate(cell("cloture")),
    ownerIds: ids(cell("responsable")),
    contactId: firstId(cell("contact")),
  };
}

/**
 * Évaluateur du nom de contact quand la colonne `nom` est une formule (valeurs jamais stockées,
 * même évaluation que le montant formule). `undefined` si le nom est une colonne ordinaire.
 */
export function contactNameOf(ctx: CrmContext): ((row: CrmRow) => unknown) | undefined {
  const colId = ctx.fieldColumn("contacts", "nom");
  const columns: ColumnDto[] = ctx.columns.contacts;
  const col = colId === null ? undefined : columns.find((c) => c.id === colId);
  if (!col || col.type !== "formula") return undefined;
  const formula = String(col.config?.formula ?? "");
  return (row) => evaluateFormula(formula, row as unknown as DbRow, columns as unknown as DbColumn[]);
}

/** Lecteur de contact lié au contexte (nom formule évalué). */
export function contactReader(ctx: CrmContext): (row: CrmRow) => ContactDto {
  const nameOf = contactNameOf(ctx);
  return (row) => toContact(row, ctx.fieldColumn, nameOf);
}

function nameString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export function toContact(
  row: CrmRow,
  fieldColumn: FieldColumn,
  nameOf?: (row: CrmRow) => unknown,
): ContactDto {
  const cell = (key: string) => cellOf(row, fieldColumn, "contacts", key);
  return {
    id: row.id,
    name: (nameOf ? nameString(nameOf(row)) : str(cell("nom"))) ?? "",
    email: str(cell("email")),
    phone: str(cell("telephone")),
    org: str(cell("structure")),
  };
}

export function toInteraction(row: CrmRow, fieldColumn: FieldColumn): InteractionDto {
  const cell = (key: string) => cellOf(row, fieldColumn, "interactions", key);
  return {
    id: row.id,
    date: readIsoDate(cell("date")),
    type: str(cell("type")),
    title: str(cell("intitule")),
    note: str(cell("compte_rendu")),
    dealId: firstId(cell("dossier")),
  };
}

export function isOpenDeal(d: DealDto, closed: string[]): boolean {
  return d.status === null || !closed.includes(d.status);
}

/** En retard = ouvert et relance strictement antérieure à aujourd'hui (le jour même est « Aujourd'hui »). */
export function isLate(d: DealDto, closed: string[], today: string): boolean {
  return isOpenDeal(d, closed) && relanceBucket(d.relance, today, 0) === "late";
}

export function filterDeals(
  deals: DealDto[],
  f: {
    mine?: { userId: string } | null;
    late?: boolean;
    ownerId?: string | null;
    closed: string[];
    today: string;
  },
): DealDto[] {
  return deals.filter((d) => {
    if (f.mine && !d.ownerIds.includes(f.mine.userId)) return false;
    if (f.ownerId && !d.ownerIds.includes(f.ownerId)) return false;
    if (f.late && !isLate(d, f.closed, f.today)) return false;
    return true;
  });
}
