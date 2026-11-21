import {
  pgTable, uuid, varchar, boolean, integer, timestamp, pgEnum, index, primaryKey, numeric, jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./schema";

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  plan: varchar("plan", { length: 50 }).notNull().default("free"),
  // Validité temporaire du plan : NULL = plan permanent, sinon retour à previousPlan à l'échéance
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  previousPlan: varchar("previous_plan", { length: 50 }),
  licenseKey: varchar("license_key", { length: 512 }),
  // Plafonds de l'organisation : NULL = pas de plafond (illimité, ou limites
  // négociées pour Enterprise). Valeurs par défaut alignées sur le plan gratuit.
  maxUsers: integer("max_users").default(5),
  maxSpaces: integer("max_spaces").default(2),
  isActive: boolean("is_active").notNull().default(true),
  // Colonnes SaaS billing
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  subscriptionStatus: varchar("subscription_status", { length: 50 }).default("inactive"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // NULL = stockage sans plafond de grille (Enterprise, sur mesure).
  maxStorageGb: numeric("max_storage_gb", { precision: 6, scale: 2 }).default("1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index("idx_org_members_user").on(t.userId),
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}));

// ============================================================
// BRAND KIT — identité visuelle de l'organisation (Studio /design)
// ============================================================

export const brandKits = pgTable("brand_kits", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  colors: jsonb("colors").$type<string[]>().notNull().default([]),
  logos: jsonb("logos").$type<{ url: string; name: string }[]>().notNull().default([]),
  fontHeading: varchar("font_heading", { length: 100 }),
  fontBody: varchar("font_body", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
