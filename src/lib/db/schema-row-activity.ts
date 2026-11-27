import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  jsonb,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users, userDatabases, tasks } from "./schema";
import type { InferSelectModel } from "drizzle-orm";

export const rowChangeKindEnum = pgEnum("row_change_kind", [
  "created",
  "updated",
  "deleted",
]);

export const rowChangeSourceEnum = pgEnum("row_change_source", [
  "ui",
  "automation",
  "import",
  "public_form",
  "sync",
  "relation_sync",
  "restore",
  "system",
  "ai",
]);

export type RowChangeSource = (typeof rowChangeSourceEnum.enumValues)[number];

export type RowChangeEntry = {
  columnId: string;
  columnName: string;
  columnType: string;
  before: unknown;
  after: unknown;
  truncated?: boolean;
};

export const databaseRowChanges = pgTable(
  "database_row_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => userDatabases.id, { onDelete: "cascade" }),
    // No foreign key: a restore re-inserts the row with the same id.
    rowId: uuid("row_id").notNull(),
    kind: rowChangeKindEnum("kind").notNull(),
    source: rowChangeSourceEnum("source").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorLabel: varchar("actor_label", { length: 120 }),
    automationId: uuid("automation_id"),
    batchId: uuid("batch_id").notNull(),
    changes: jsonb("changes").$type<RowChangeEntry[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_row_changes_row").on(
      t.databaseId,
      t.rowId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("idx_row_changes_batch").on(t.batchId),
    // Candidate lookup of the 30-day purge (only `deleted` entries).
    index("idx_row_changes_deleted")
      .on(t.databaseId, t.rowId, t.createdAt)
      .where(sql`${t.kind} = 'deleted'`),
  ],
);

export const rowTaskEventKindEnum = pgEnum("row_task_event_kind", [
  "created",
  "completed",
  "reopened",
]);

export type RowTaskEventKind = (typeof rowTaskEventKindEnum.enumValues)[number];

export const databaseRowComments = pgTable(
  "database_row_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => userDatabases.id, { onDelete: "cascade" }),
    // No foreign key: a restore re-inserts the row with the same id.
    rowId: uuid("row_id").notNull(),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_row_comments_row").on(
      t.databaseId,
      t.rowId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("idx_row_comments_deleted")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export type RowComment = InferSelectModel<typeof databaseRowComments>;

export const databaseRowTaskEvents = pgTable(
  "database_row_task_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => userDatabases.id, { onDelete: "cascade" }),
    rowId: uuid("row_id").notNull(),
    kind: rowTaskEventKindEnum("kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_row_task_events_row").on(
      t.databaseId,
      t.rowId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("idx_row_task_events_task").on(t.taskId),
  ],
);
