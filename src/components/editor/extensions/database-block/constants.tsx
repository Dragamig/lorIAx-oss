"use client";

import {
  Type,
  Hash,
  Calendar,
  ChevronDown,
  CheckSquare,
  Link2,
  Table2,
  Kanban,
  LayoutGrid,
  ImageIcon,
  FunctionSquare,
  Globe,
  Mail,
  Paperclip,
  Clock,
  ListOrdered,
  UserRound,
  FileText,
} from "lucide-react";
import type { ColumnType, ViewMode, FilterOperator } from "./types";

export const COLUMN_TYPE_ICONS: Record<ColumnType, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  number: <Hash className="h-3.5 w-3.5" />,
  date: <Calendar className="h-3.5 w-3.5" />,
  select: <ChevronDown className="h-3.5 w-3.5" />,
  checkbox: <CheckSquare className="h-3.5 w-3.5" />,
  relation: <Link2 className="h-3.5 w-3.5" />,
  image: <ImageIcon className="h-3.5 w-3.5" />,
  formula: <FunctionSquare className="h-3.5 w-3.5" />,
  url: <Globe className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  attachment: <Paperclip className="h-3.5 w-3.5" />,
  time: <Clock className="h-3.5 w-3.5" />,
  autonumber: <ListOrdered className="h-3.5 w-3.5" />,
  person: <UserRound className="h-3.5 w-3.5" />,
  document_link: <FileText className="h-3.5 w-3.5" />,
};

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Texte",
  number: "Nombre",
  date: "Date",
  select: "Choix",
  checkbox: "Case à cocher",
  relation: "Relation",
  image: "Image",
  formula: "Formule",
  url: "URL",
  email: "E-mail",
  attachment: "Pièces jointes",
  time: "Heure",
  autonumber: "Numérotation auto",
  person: "Personne",
  document_link: "Lien document",
};

export { formatAutonumber } from "./autonumber-format";

export const VIEW_ICONS: Record<ViewMode, React.ReactNode> = {
  table: <Table2 className="h-3.5 w-3.5" />,
  kanban: <Kanban className="h-3.5 w-3.5" />,
  gallery: <LayoutGrid className="h-3.5 w-3.5" />,
};

export const VIEW_LABELS: Record<ViewMode, string> = {
  table: "Tableau",
  kanban: "Kanban",
  gallery: "Galerie",
};

// ─── Filtres : opérateurs par type de colonne ──────────────────────────────────

const TEXT_OPS: FilterOperator[] = ["contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty"];
const NUMBER_OPS: FilterOperator[] = ["eq", "neq", "lt", "lte", "gt", "gte", "is_empty", "is_not_empty"];
const DATE_OPS: FilterOperator[] = [
  "is", "is_not", "is_before", "is_after", "is_on_or_before", "is_on_or_after",
  "is_today", "is_this_week", "is_this_month", "is_this_year", "is_this_quarter", "is_within_days",
  "is_empty", "is_not_empty",
];
const SELECT_OPS: FilterOperator[] = ["is", "is_not", "is_empty", "is_not_empty"];
const CHECKBOX_OPS: FilterOperator[] = ["is_checked", "is_not_checked"];
const PRESENCE_OPS: FilterOperator[] = ["is_empty", "is_not_empty"];

export const FILTER_OPERATORS_BY_TYPE: Record<ColumnType, FilterOperator[]> = {
  text: TEXT_OPS,
  url: TEXT_OPS,
  email: TEXT_OPS,
  formula: TEXT_OPS,
  number: NUMBER_OPS,
  autonumber: NUMBER_OPS,
  date: DATE_OPS,
  time: DATE_OPS,
  select: SELECT_OPS,
  checkbox: CHECKBOX_OPS,
  relation: ["contains", "not_contains", "is_empty", "is_not_empty"],
  image: PRESENCE_OPS,
  attachment: PRESENCE_OPS,
  person: ["is_empty", "is_not_empty", "is_me"],
  document_link: ["contains", "is_empty", "is_not_empty"],
};

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contient",
  not_contains: "ne contient pas",
  is: "est",
  is_not: "n'est pas",
  is_empty: "est vide",
  is_not_empty: "n'est pas vide",
  eq: "=",
  neq: "≠",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  is_checked: "est coché",
  is_not_checked: "n'est pas coché",
  is_before: "est avant",
  is_after: "est après",
  is_on_or_before: "est le ou avant",
  is_on_or_after: "est le ou après",
  is_today: "est aujourd'hui",
  is_this_week: "est cette semaine",
  is_this_month: "est ce mois-ci",
  is_this_year: "est cette année",
  is_this_quarter: "ce trimestre",
  is_within_days: "est dans les N prochains jours",
  is_me: "est moi",
};

// Ré-exporté depuis filter-tree (module pur, importable côté serveur).
export { DEFAULT_FILTER_OPERATOR } from "./filter-tree";

// Opérateurs qui n'ont pas besoin d'une valeur saisie (l'input est masqué).
export const FILTER_NO_VALUE_OPS = new Set<FilterOperator>([
  "is_empty", "is_not_empty", "is_checked", "is_not_checked",
  // dates relatives — la valeur de référence est « maintenant », pas de saisie
  "is_today", "is_this_week", "is_this_month", "is_this_year", "is_this_quarter",
  "is_me",
]);
