/**
 * Module « Présentations » (moteur Bento vendorisé).
 *
 * Métadonnées seulement : la charge utile d'une présentation (le document JSON
 * du runtime) vit dans S3, sous `presentations/<id>.json`, comme le studio
 * design le fait pour ses canevas.
 *
 * La portée d'accès est l'ESPACE, pas le document. Une présentation doit
 * pouvoir exister sans document porteur (module autonome), là où
 * `design_snapshots` n'a qu'un rattachement documentaire. `documentId` reste
 * renseigné quand la présentation naît d'un bloc de l'éditeur, pour l'affichage
 * et l'héritage de classification, mais il n'est jamais la clé d'autorisation.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { documents, organizations, spaces, users } from "./schema";

export const presentations = pgTable(
  "presentations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default("Nouvelle présentation"),
    /**
     * Espace d'une présentation ordinaire. Nul pour un modèle, qui se rattache
     * à l'organisation (`organizationId`). CHECK : au moins l'un des deux.
     */
    spaceId: uuid("space_id").references(() => spaces.id, {
      onDelete: "cascade",
    }),
    /** Renseignée pour les modèles seulement. */
    organizationId: uuid("organization_id").references(
      () => organizations.id,
      { onDelete: "cascade" }
    ),
    /** Vrai pour un modèle d'organisation (livré LorIAx ou créé par l'admin). */
    isTemplate: boolean("is_template").notNull().default(false),
    templateDescription: text("template_description"),
    /** `lorIAx` pour les modèles semés, nul pour les modèles créés par l'organisation. */
    templateOrigin: text("template_origin"),
    /** Clé de semis (`pitch`, `meeting-notes`, `training`, `status-update`) : idempotence par organisation. */
    templateSeedKey: text("template_seed_key"),
    /** Masquage : la ligne reste, donc le semis ne la recrée jamais. */
    templateHiddenAt: timestamp("template_hidden_at", { withTimezone: true }),
    /**
     * Document porteur quand la présentation naît d'un bloc de l'éditeur.
     * `set null` et non `cascade` : supprimer le document ne doit pas emporter
     * une présentation que le module autonome continue de lister.
     */
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    /**
     * Compteur de révisions, base du contrôle de concurrence optimiste : le
     * client renvoie la version qu'il croit détenir, un écart rend 409 au lieu
     * d'écraser en silence le travail d'un autre onglet.
     */
    version: integer("version").notNull().default(1),
    slideCount: integer("slide_count").notNull().default(0),
    /** Clé S3 de la vignette, affichée par le bloc sans charger le runtime. */
    thumbnailKey: text("thumbnail_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_presentations_space").on(table.spaceId),
    index("idx_presentations_document").on(table.documentId),
    /** Idempotence du semis des modèles LorIAx, par organisation. */
    uniqueIndex("idx_presentations_template_seed")
      .on(table.organizationId, table.templateSeedKey)
      .where(sql`${table.templateSeedKey} IS NOT NULL`),
    /** Liste des modèles d'une organisation (listTemplates). */
    index("idx_presentations_org_templates")
      .on(table.organizationId)
      .where(sql`${table.isTemplate}`),
    check(
      "presentations_space_or_template_chk",
      sql`space_id IS NOT NULL OR is_template`
    ),
  ]
);

export type Presentation = typeof presentations.$inferSelect;
export type NewPresentation = typeof presentations.$inferInsert;
