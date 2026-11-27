import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users, spaces } from "./schema";
import { organizations } from "./schema-org";
import { mediaFolders } from "./schema-media";

/** Vues enregistrées de la médiathèque : une chaîne de filtres (`serializeMediaFilters`) nommée. */
export const mediaSavedViews = pgTable(
  "media_saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    query: text("query").notNull().default(""),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_media_saved_views_user_name").on(t.userId, t.name),
    index("idx_media_saved_views_org").on(t.organizationId, t.shared),
  ],
);

/** Envois multipart directs vers S3 (vidéos volumineuses). La ligne `media` n'existe qu'à la fin. */
export const mediaMultipartUploads = pgTable(
  "media_multipart_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "set null" }),
    folderId: uuid("folder_id").references(() => mediaFolders.id, { onDelete: "set null" }),
    filename: varchar("filename", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    partSize: integer("part_size").notNull(),
    s3UploadId: varchar("s3_upload_id", { length: 1024 }).notNull(),
    storageKey: varchar("storage_key", { length: 1024 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    /** Libellés de tags choisis à l'envoi, liés au média à la finalisation. */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_media_multipart_status_expires").on(t.status, t.expiresAt),
    index("idx_media_multipart_org_user").on(t.organizationId, t.userId),
  ],
);

export type MediaSavedView = typeof mediaSavedViews.$inferSelect;
export type MediaMultipartUpload = typeof mediaMultipartUploads.$inferSelect;
