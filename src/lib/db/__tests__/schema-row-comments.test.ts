import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { databaseRowComments, databaseRowTaskEvents, rowTaskEventKindEnum } from "../schema-row-activity";
import { tasks, taskKindEnum, notifications } from "../schema";

describe("schema commentaires et événements de ligne", () => {
  it("database_row_comments expose les colonnes de la spec", () => {
    expect(Object.keys(getTableColumns(databaseRowComments)).sort()).toEqual([
      "authorId", "body", "createdAt", "databaseId", "deletedAt", "editedAt", "id", "mentions", "rowId",
    ]);
  });

  it("database_row_task_events expose les colonnes de la spec", () => {
    expect(Object.keys(getTableColumns(databaseRowTaskEvents)).sort()).toEqual([
      "actorUserId", "createdAt", "databaseId", "id", "kind", "rowId", "taskId",
    ]);
  });

  it("les index nommés existent", () => {
    const names = (t: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(t).indexes.map((i) => i.config.name);
    expect(names(databaseRowComments)).toEqual(
      expect.arrayContaining(["idx_row_comments_row", "idx_row_comments_deleted"]),
    );
    expect(names(databaseRowTaskEvents)).toEqual(
      expect.arrayContaining(["idx_row_task_events_row", "idx_row_task_events_task"]),
    );
    expect(names(tasks)).toContain("idx_tasks_database_row");
  });

  it("tasks gagne databaseId et rowId, taskKindEnum contient database_row", () => {
    const cols = getTableColumns(tasks);
    expect(cols).toHaveProperty("databaseId");
    expect(cols).toHaveProperty("rowId");
    expect(taskKindEnum.enumValues).toContain("database_row");
    expect(getTableConfig(tasks).checks.map((c) => c.name)).toContain("tasks_database_row_ctx");
  });

  it("notifications gagne databaseId et rowId", () => {
    const cols = getTableColumns(notifications);
    expect(cols).toHaveProperty("databaseId");
    expect(cols).toHaveProperty("rowId");
  });

  it("rowTaskEventKindEnum a les trois valeurs", () => {
    expect(rowTaskEventKindEnum.enumValues).toEqual(["created", "completed", "reopened"]);
  });
});
