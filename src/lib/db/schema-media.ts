import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  char,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users, spaces, documents } from "./schema";
import { organizations } from "./schema-org";

export const mediaKindEnum = pgEnum("media_kind", [
  "image",
  "pdf",
  "document",
  "video",
  "audio",
  "archive",
  "other",
]);

export const mediaOriginEnum = pgEnum("media_origin", [
  "upload",
  "stock",
  "automation",
  "studio",
]);

export const mediaUsageTargetEnum = pgEnum("media_usage_target", [
  "document",
  "database_row",
  "design",
  "video_project",
  "brand_kit",
  "presentation",
]);

export const mediaUsageSourceEnum = pgEnum("media_usage_source", [
  "content",
  "explicit",
]);

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Dossiers de la médiathèque : une arborescence commune à l'organisation. */
export const mediaFolders = pgTable(
  "media_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => mediaFolders.id, {
      onDelete: "restrict",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_media_folders_name").on(
      t.organizationId,
      sql`coalesce(${t.parentId}, ${sql.raw(`'${NIL_UUID}'::uuid`)})`,
      t.name,
    ),
    index("idx_media_folders_parent").on(t.organizationId, t.parentId),
  ],
);

/** Médias : table unique des fichiers, identifiants repris des anciennes tables attachments et studio_images. */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "set null" }),
    folderId: uuid("folder_id").references(() => mediaFolders.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    filename: varchar("filename", { length: 500 }).notNull(),
    title: varchar("title", { length: 500 }),
    altText: varchar("alt_text", { length: 500 }),
    description: text("description"),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    kind: mediaKindEnum("kind").notNull(),
    origin: mediaOriginEnum("origin").notNull().default("upload"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    checksumSha256: char("checksum_sha256", { length: 64 }),
    width: integer("width"),
    height: integer("height"),
    pageCount: integer("page_count"),
    thumbnailKey: varchar("thumbnail_key", { length: 1024 }),
    currentVersion: integer("current_version").notNull().default(1),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_media_storage_key").on(t.storageKey),
    index("idx_media_org_list").on(t.organizationId, t.deletedAt, t.createdAt.desc()),
    index("idx_media_org_space").on(t.organizationId, t.spaceId, t.deletedAt),
    index("idx_media_folder").on(t.folderId),
    index("idx_media_kind").on(t.kind),
    index("idx_media_checksum").on(t.checksumSha256),
    index("idx_media_uploaded_by").on(t.uploadedBy),
    index("idx_media_no_space")
      .on(t.organizationId)
      .where(sql`${t.spaceId} is null`),
    index("idx_media_filename_trgm").using("gin", t.filename.op("gin_trgm_ops")),
    index("idx_media_title_trgm").using("gin", t.title.op("gin_trgm_ops")),
  ],
);

export const mediaTags = pgTable(
  "media_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_media_tags_slug").on(t.organizationId, t.slug)],
);

export const mediaTagLinks = pgTable(
  "media_tag_links",
  {
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => mediaTags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.mediaId, t.tagId] }),
    index("idx_media_tag_links_tag").on(t.tagId),
  ],
);

/** Emplacements où un média est utilisé (pas de FK sur target_id : cibles multiples). */
export const mediaUsages = pgTable(
  "media_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    targetType: mediaUsageTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    context: varchar("context", { length: 120 }),
    source: mediaUsageSourceEnum("source").notNull().default("content"),
    spaceId: uuid("space_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_media_usages_slot").on(
      t.mediaId,
      t.targetType,
      t.targetId,
      sql`coalesce(${t.context}, '')`,
    ),
    index("idx_media_usages_target").on(t.targetType, t.targetId),
    index("idx_media_usages_media").on(t.mediaId),
  ],
);

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type MediaKind = (typeof mediaKindEnum.enumValues)[number];
export type MediaUsageTarget = (typeof mediaUsageTargetEnum.enumValues)[number];
export type MediaUsageSource = (typeof mediaUsageSourceEnum.enumValues)[number];
