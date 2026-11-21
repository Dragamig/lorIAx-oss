import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================
// KNOWLEDGE BASE CHUNKS (pgvector) — RAG help assistant
// ============================================================

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // identifiant de la source, ex. "01-documents-editeur"
    source: varchar("source", { length: 255 }).notNull(),
    // titre de la source (frontmatter)
    title: varchar("title", { length: 500 }),
    chunkIndex: integer("chunk_index").notNull().default(0),
    chunkText: text("chunk_text").notNull(),
    // sha256 du chunk, pour l'indexation incrementale
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    // modele d'embedding utilise (ex. mistral-embed)
    model: varchar("model", { length: 100 }).notNull(),
    // Note: le champ vector (embedding) sera gere via SQL brut dans la migration
    // car drizzle-orm n'a pas de support natif pour le type vector
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_kb_chunks_source_chunk").on(
      table.source,
      table.chunkIndex
    ),
  ]
);

export type KbChunk = typeof kbChunks.$inferSelect;
export type NewKbChunk = typeof kbChunks.$inferInsert;
