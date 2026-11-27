import { pgTable, pgEnum, uuid, varchar, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users, userDatabases } from "./schema";
import { organizations } from "./schema-org";

export const aiProposalTypeEnum = pgEnum("ai_proposal_type", [
  "update_rows",
  "delete_rows",
  "merge_duplicates",
  "create_rows",
]);

export const aiProposalStatusEnum = pgEnum("ai_proposal_status", [
  "pending",
  "applying",
  "applied",
  "dismissed",
  "stale",
  "undone",
  "expired",
  "failed",
]);

export type AiProposalType = (typeof aiProposalTypeEnum.enumValues)[number];
export type AiProposalStatus = (typeof aiProposalStatusEnum.enumValues)[number];

/**
 * Proposition de modification de lignes calculée par le chat IA, appliquée
 * seulement après clic de l'utilisateur. Résumé, nombre de lignes et conflits
 * sont dérivés de `payload` à la lecture (pas de colonnes dédiées).
 */
export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => userDatabases.id, { onDelete: "cascade" }),
    type: aiProposalTypeEnum("type").notNull(),
    payload: jsonb("payload").notNull(),
    freshness: jsonb("freshness").notNull(),
    status: aiProposalStatusEnum("status").notNull().default("pending"),
    undoSnapshot: jsonb("undo_snapshot"),
    batchId: uuid("batch_id").notNull().defaultRandom(),
    replacesId: uuid("replaces_id"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_ai_proposals_user_status").on(t.userId, t.status),
    index("idx_ai_proposals_expires").on(t.expiresAt),
  ],
);

export type AiProposalRow = typeof aiProposals.$inferSelect;

export type AiToolCallStatus = "ok" | "error" | "refused";

/** Journal d'appels d'outils du chat IA (arguments rédigés, sans contenu de cellules). */
export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tool: varchar("tool", { length: 100 }).notNull(),
    args: jsonb("args").notNull(),
    status: varchar("status", { length: 16 }).$type<AiToolCallStatus>().notNull(),
    durationMs: integer("duration_ms").notNull(),
    proposalId: uuid("proposal_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_ai_tool_calls_org_created").on(t.orgId, t.createdAt)],
);
