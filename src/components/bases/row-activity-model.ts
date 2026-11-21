import type { RowChangeEntry } from "@/lib/db/schema-row-activity";
import type { RowHistoryItem } from "@/lib/databases/row-history-types";
import type {
  RowActivityComment,
  RowActivityItem,
  RowActivityTaskEvent,
} from "@/lib/databases/row-activity-types";

export const GROUP_WINDOW_MS = 120_000;

export type RowHistoryGroup = {
  /** Id of the newest entry of the group. */
  key: string;
  kind: RowHistoryItem["kind"];
  source: RowHistoryItem["source"];
  actor: RowHistoryItem["actor"];
  actorLabel: string | null;
  automationId: string | null;
  /** Timestamp of the newest entry. */
  createdAt: string;
  items: RowHistoryItem[];
  /** Every change of every entry, newest first. */
  changes: RowChangeEntry[];
};

function actorKey(item: RowHistoryItem): string {
  return item.actor?.id ?? `label:${item.actorLabel ?? ""}`;
}

function toGroup(item: RowHistoryItem): RowHistoryGroup {
  return {
    key: item.id,
    kind: item.kind,
    source: item.source,
    actor: item.actor,
    actorLabel: item.actorLabel,
    automationId: item.automationId,
    createdAt: item.createdAt,
    items: [item],
    changes: [...item.changes],
  };
}

/**
 * Merges consecutive `updated` entries (newest first) of the same actor and source
 * spaced by less than `windowMs`. `created` and `deleted` never merge; a `deleted`
 * entry is hidden until a newer `restore` entry exists for the row.
 */
export function groupRowHistory(items: RowHistoryItem[], windowMs = GROUP_WINDOW_MS): RowHistoryGroup[] {
  const groups: RowHistoryGroup[] = [];
  let restoreSeen = false;
  let last: RowHistoryItem | null = null;
  for (const item of items) {
    if (item.kind === "deleted" && !restoreSeen) {
      last = null;
      continue;
    }
    if (item.source === "restore") restoreSeen = true;
    const prev = groups[groups.length - 1];
    if (
      item.kind === "updated" &&
      prev &&
      prev.kind === "updated" &&
      last &&
      actorKey(last) === actorKey(item) &&
      last.source === item.source &&
      new Date(last.createdAt).getTime() - new Date(item.createdAt).getTime() < windowMs
    ) {
      prev.items.push(item);
      prev.changes.push(...item.changes);
    } else {
      groups.push(toGroup(item));
    }
    last = item;
  }
  return groups;
}

export type RowActivityEntry =
  | ({ type: "change-group" } & RowHistoryGroup)
  | RowActivityComment
  | RowActivityTaskEvent;

/**
 * Groups a merged timeline (newest first). Only contiguous `change` items merge: a comment
 * or a task event breaks the run, so the time window never crosses it. The rule "a
 * `deleted` entry is hidden until a newer restore exists" is kept, over the whole list.
 */
export function groupRowActivity(items: RowActivityItem[], windowMs = GROUP_WINDOW_MS): RowActivityEntry[] {
  const out: RowActivityEntry[] = [];
  let restoreSeen = false;
  let last: RowHistoryItem | null = null;
  for (const item of items) {
    if (item.type !== "change") {
      out.push(item);
      last = null;
      continue;
    }
    if (item.kind === "deleted" && !restoreSeen) {
      last = null;
      continue;
    }
    if (item.source === "restore") restoreSeen = true;
    const prev = out[out.length - 1];
    if (
      item.kind === "updated" &&
      prev &&
      prev.type === "change-group" &&
      prev.kind === "updated" &&
      last &&
      actorKey(last) === actorKey(item) &&
      last.source === item.source &&
      new Date(last.createdAt).getTime() - new Date(item.createdAt).getTime() < windowMs
    ) {
      prev.items.push(item);
      prev.changes.push(...item.changes);
    } else {
      out.push({ type: "change-group", ...toGroup(item) });
    }
    last = item;
  }
  return out;
}

export type HistoryValueLabels = {
  locale: string;
  empty: string;
  yes: string;
  no: string;
  files: (n: number) => string;
  /** Fallback when linked rows cannot be resolved to a title. */
  linked: (n: number) => string;
  /** Fallback when people cannot be resolved to a name. */
  people: (n: number) => string;
  /** Title of a linked row for a relation column, or null when unknown. */
  relationLabel?: (columnId: string, rowId: string) => string | null;
  /** Display name of a user, or null when unknown. */
  personName?: (userId: string) => string | null;
};

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Formats a frozen before/after value according to the column type stored in the entry. */
export function formatHistoryValue(
  value: unknown,
  columnType: string,
  labels: HistoryValueLabels,
  columnId?: string,
): string {
  if (isEmpty(value)) return labels.empty;
  if (columnType === "relation" || columnType === "person") {
    const ids = (Array.isArray(value) ? value : [value]).map(String);
    const names: string[] = [];
    let unresolved = 0;
    for (const id of ids) {
      const name =
        columnType === "relation" ? (columnId ? labels.relationLabel?.(columnId, id) : null) : labels.personName?.(id);
      if (name) names.push(name);
      else unresolved += 1;
    }
    if (unresolved > 0) names.push(columnType === "relation" ? labels.linked(unresolved) : labels.people(unresolved));
    return names.join(", ");
  }
  if (columnType === "document_link") {
    if (typeof value === "string") {
      try {
        const ref = JSON.parse(value) as { title?: unknown };
        if (typeof ref.title === "string" && ref.title) return ref.title;
      } catch {
        /* valeur non-JSON : repli ci-dessous */
      }
    }
    return labels.linked(1);
  }
  if (columnType === "checkbox") {
    return value === true || value === "true" ? labels.yes : labels.no;
  }
  if (columnType === "attachment" || columnType === "image") {
    return labels.files(Array.isArray(value) ? value.length : 1);
  }
  if (columnType === "date" && typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      try {
        return new Intl.DateTimeFormat(labels.locale, { dateStyle: "medium", timeZone: "UTC" }).format(d);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
