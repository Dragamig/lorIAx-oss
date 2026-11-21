import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { organizations } from "./schema-org";
import { userDatabaseAutomations, users } from "./schema";

/** Clé d'API Tally d'une organisation, chiffrée au repos (AES-256-GCM, ENCRYPTION_KEY). */
export const tallyConnections = pgTable("tally_connections", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  /** Quatre derniers caractères de la clé, seule trace lisible. */
  keySuffix: varchar("key_suffix", { length: 8 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Import de soumissions Tally dans un automatisme webhook entrant. */
export const tallyImports = pgTable(
  "tally_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => userDatabaseAutomations.id, { onDelete: "cascade" }),
    formId: varchar("form_id", { length: 64 }).notNull(),
    /** 'simulate' | 'real' */
    mode: varchar("mode", { length: 10 }).notNull(),
    /** 'pending' | 'running' | 'completed' | 'cancelled' | 'failed' */
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    since: timestamp("since", { withTimezone: true }),
    cap: integer("cap").notNull(),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    created: integer("created").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    ignored: integer("ignored").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    errorMessage: text("error_message"),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_tally_imports_automation").on(t.automationId, t.createdAt),
    // Un seul import non terminé par automatisme (garanti par la base, pas par une lecture préalable).
    uniqueIndex("uq_tally_imports_active")
      .on(t.automationId)
      .where(sql`${t.status} in ('pending','running')`),
  ]
);

/** Soumissions déjà rejouées en réel (idempotence des imports). */
export const tallyImportedSubmissions = pgTable(
  "tally_imported_submissions",
  {
    automationId: uuid("automation_id")
      .notNull()
      .references(() => userDatabaseAutomations.id, { onDelete: "cascade" }),
    submissionId: varchar("submission_id", { length: 128 }).notNull(),
    importId: uuid("import_id").references(() => tallyImports.id, { onDelete: "set null" }),
    /** 'reserved' pendant l'exécution, 'done' une fois la réponse traitée. */
    state: varchar("state", { length: 10 }).notNull().default("done"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.automationId, t.submissionId] })]
);

/** Détail par soumission d'un import (liste du récapitulatif, lien vers le run, trace simulée). */
export const tallyImportItems = pgTable(
  "tally_import_items",
  {
    importId: uuid("import_id")
      .notNull()
      .references(() => tallyImports.id, { onDelete: "cascade" }),
    submissionId: varchar("submission_id", { length: 128 }).notNull(),
    position: integer("position").notNull(),
    name: varchar("name", { length: 200 }),
    email: varchar("email", { length: 200 }),
    /** 'created' | 'completed' | 'ignored' | 'error' | 'unknown' */
    outcome: varchar("outcome", { length: 10 }).notNull(),
    /** Noms des colonnes remplies (résolus à l'import). */
    filledColumns: jsonb("filled_columns").$type<string[]>().notNull().default([]),
    errorMessage: text("error_message"),
    /** Run réel (automation_runs), absent en simulation. */
    runId: uuid("run_id"),
    /** Trace rédigée d'une simulation (bornée), absente en réel. */
    trace: jsonb("trace").$type<unknown[] | null>(),
    traceTruncated: boolean("trace_truncated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.submissionId] }),
    index("idx_tally_import_items_order").on(t.importId, t.position),
    index("idx_tally_import_items_created").on(t.createdAt),
  ]
);
