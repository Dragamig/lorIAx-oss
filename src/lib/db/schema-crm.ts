import { pgTable, uuid, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { users, userDatabases } from "./schema";
import { organizations } from "./schema-org";

/** Rôles d'une base dans le module CRM. */
export type CrmRole = "contacts" | "dossiers" | "interactions";

/** Association rôle, champ CRM, identifiant de colonne (null = champ non raccordé). */
export type CrmFieldMap = Partial<Record<CrmRole, Record<string, string | null>>>;

/**
 * Configuration du module CRM par organisation : quelle base joue quel rôle.
 * Aucune donnée métier ici, les données restent dans les bases raccordées.
 */
export const crmConnections = pgTable("crm_connections", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  contactsDatabaseId: uuid("contacts_database_id").references(() => userDatabases.id, {
    onDelete: "set null",
  }),
  dealsDatabaseId: uuid("deals_database_id").references(() => userDatabases.id, {
    onDelete: "set null",
  }),
  interactionsDatabaseId: uuid("interactions_database_id").references(() => userDatabases.id, {
    onDelete: "set null",
  }),
  createdDatabaseIds: jsonb("created_database_ids").$type<string[]>().notNull().default([]),
  fieldMap: jsonb("field_map").$type<CrmFieldMap>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type CrmConnectionRow = typeof crmConnections.$inferSelect;
