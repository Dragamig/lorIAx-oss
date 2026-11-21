import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { documents, users } from "./schema";

/**
 * Cycle de vie d'une note vocale.
 *
 * `recording`    : note créée, aucun audio reçu.
 * `transcribing` : audio reçu, transcription en cours.
 * `review`       : transcript disponible, en attente de validation humaine.
 * `validated`    : transcript validé, audio effacé, traitements IA autorisés.
 * `failed`       : transcription échouée, audio conservé pour relance.
 */
export const voiceNoteStatusEnum = pgEnum("voice_note_status", [
  "recording",
  "transcribing",
  "review",
  "validated",
  "failed",
]);

/**
 * Note vocale rattachée à un document : le node TipTap ne porte que l'id.
 * Les droits sont portés par le document parent (cf. lib/voice-notes/access.ts),
 * jamais par la note elle-même.
 */
export const voiceNotes = pgTable(
  "voice_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    status: voiceNoteStatusEnum("status").notNull().default("recording"),
    /** Chemin du fichier audio local, vidé à la validation du transcript. */
    audioPath: varchar("audio_path", { length: 1024 }),
    durationSeconds: integer("duration_seconds"),
    transcript: text("transcript"),
    transcriptValidatedAt: timestamp("transcript_validated_at", {
      withTimezone: true,
    }),
    summary: text("summary"),
    cleanedText: text("cleaned_text"),
    /** Empreinte du transcript ayant produit `summary` (sha256 hex). */
    summaryTranscriptHash: varchar("summary_transcript_hash", { length: 64 }),
    /** Empreinte du transcript ayant produit `cleaned_text` (sha256 hex). */
    cleanedTranscriptHash: varchar("cleaned_transcript_hash", { length: 64 }),
    /**
     * Traitement IA en cours (`summary` ou `cleanup`), sinon NULL.
     *
     * La route de traitement rend la main tout de suite et laisse le travail
     * courir en tâche de fond : sans ce marqueur, ni le bloc ni le serveur ne
     * sauraient qu'un traitement est engagé après la fermeture du document.
     */
    processingKind: varchar("processing_kind", { length: 16 }),
    /** Départ du traitement en cours : sert à requalifier un travail perdu. */
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    errorCode: varchar("error_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("voice_notes_document_id_idx").on(table.documentId)]
);

export type VoiceNote = typeof voiceNotes.$inferSelect;
export type NewVoiceNote = typeof voiceNotes.$inferInsert;
