import {
  pgTable,
  unique,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  date,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";
import { organizations } from "./schema-org";
import { media } from "./schema-media";

export type MediaTextStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type MediaTextSource = "pdf" | "office" | "sheet" | "text" | "exif" | "transcript";

/**
 * Texte extrait d'un média, qui sert aussi de file de tâches d'indexation
 * (une ligne par média, `media_id` unique).
 */
export const mediaTexts = pgTable(
  "media_texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).$type<MediaTextStatus>().notNull().default("pending"),
    reason: varchar("reason", { length: 32 }),
    source: varchar("source", { length: 16 }).$type<MediaTextSource>(),
    text: text("text"),
    textChars: integer("text_chars").notNull().default(0),
    truncated: boolean("truncated").notNull().default(false),
    /** Valeur de `media.current_version` indexée. */
    version: integer("version").notNull().default(1),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_media_texts_media").on(t.mediaId),
    index("idx_media_texts_queue")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index("idx_media_texts_org_status").on(t.organizationId, t.status),
  ],
);

/**
 * Blocs vectorisés d'un média. La colonne `embedding vector(dim)` et son index
 * HNSW sont posés à l'exécution par `ensureMediaEmbeddingSchema()` (dimension
 * de l'index actif), comme `document_embeddings`.
 */
export const mediaEmbeddings = pgTable(
  "media_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    model: varchar("model", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_media_embeddings_media_chunk").on(t.mediaId, t.chunkIndex),
    index("idx_media_embeddings_org").on(t.organizationId),
    // Pas de vecteur sans ligne de texte : effacer ou supprimer le texte emporte ses vecteurs.
    foreignKey({
      name: "media_embeddings_media_text_fkey",
      columns: [t.mediaId],
      foreignColumns: [mediaTexts.mediaId],
    }).onDelete("cascade"),
  ],
);

/** Interrupteurs d'indexation IA par organisation, désactivés par défaut. */
export const mediaAiSettings = pgTable("media_ai_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  indexEnabled: boolean("index_enabled").notNull().default(false),
  transcribeEnabled: boolean("transcribe_enabled").notNull().default(false),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Secondes de transcription consommées par organisation et par jour (UTC), pour le plafond quotidien. */
export const mediaAiDailyUsage = pgTable(
  "media_ai_daily_usage",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    transcribeSeconds: integer("transcribe_seconds").notNull().default(0),
    indexedPasses: integer("indexed_passes").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.day] })],
);

export type MediaText = typeof mediaTexts.$inferSelect;
export type MediaEmbedding = typeof mediaEmbeddings.$inferSelect;
export type MediaAiSettings = typeof mediaAiSettings.$inferSelect;
