import { pgTable, uuid, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users, spaces } from "./schema";
import { organizations } from "./schema-org";

export const AI_CREATION_KINDS = ["spreadsheet", "document", "presentation"] as const;
export const AI_CREATION_STATUSES = [
  "pending",
  "applying",
  "applied",
  "dismissed",
  "undone",
  "expired",
  "failed",
] as const;

export type AiCreationKind = (typeof AI_CREATION_KINDS)[number];
export type AiCreationStatus = (typeof AI_CREATION_STATUSES)[number];

/**
 * Proposition de creation (tableur, document, presentation) generee par le chat
 * IA, appliquee seulement apres clic de l'utilisateur. `payload` est re-valide
 * a l'application, jamais applique tel quel. `overrides` journalise les
 * changements faits par l'utilisateur (ex. espace cible).
 */
export const aiCreationProposals = pgTable(
  "ai_creation_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 20 }).$type<AiCreationKind>().notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 20 })
      .$type<AiCreationStatus>()
      .notNull()
      .default("pending"),
    resultId: uuid("result_id"),
    resultType: varchar("result_type", { length: 20 }),
    overrides: jsonb("overrides"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [index("idx_ai_creation_proposals_org_user_status").on(t.orgId, t.userId, t.status)],
);
