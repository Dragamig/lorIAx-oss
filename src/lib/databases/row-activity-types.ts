import type { PermissionLevel } from "@/types";
import type { RowHistoryItem } from "@/lib/databases/row-history-types";

export type RowActivityChange = RowHistoryItem & { type: "change" };

export type RowActivityComment = {
  type: "comment";
  id: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  /** Null for a deleted comment (soft delete): the body never leaves the server. */
  body: string | null;
  mentions: string[];
  editedAt: string | null;
  deleted: boolean;
};

export type RowActivityTaskEvent = {
  type: "task_created" | "task_completed" | "task_reopened";
  id: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  taskId: string;
  taskTitle: string | null;
};

export type RowActivityItem = RowActivityChange | RowActivityComment | RowActivityTaskEvent;

export type RowActivityPage = {
  items: RowActivityItem[];
  nextCursor: string | null;
  permission: PermissionLevel;
  viewerId: string;
  /** True only for organization admins and owners (clearing is admin-only). */
  canClear: boolean;
};
