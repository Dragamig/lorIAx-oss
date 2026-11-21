import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./schema";
import { teams } from "./schema";
import { spaces } from "./schema";
import { documents } from "./schema";
import { organizations } from "./schema-org";

export const chatChannelTypeEnum = pgEnum("chat_channel_type", [
  "direct",
  "team",
  "space",
]);

export const chatChannels = pgTable(
  "chat_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: chatChannelTypeEnum("type").notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_chat_channels_org").on(t.organizationId),
    index("idx_chat_channels_team").on(t.teamId),
    index("idx_chat_channels_space").on(t.spaceId),
  ]
);

export const chatChannelMembers = pgTable(
  "chat_channel_members",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index("idx_chat_members_user").on(t.userId),
  ]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    content: text("content"),
    documentRef: uuid("document_ref").references(() => documents.id, { onDelete: "set null" }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_chat_messages_channel_time").on(t.channelId, t.createdAt.desc()),
  ]
);

export const chatChannelsRelations = relations(chatChannels, ({ many }) => ({
  members: many(chatChannelMembers),
  messages: many(chatMessages),
}));

export const chatChannelMembersRelations = relations(chatChannelMembers, ({ one }) => ({
  channel: one(chatChannels, { fields: [chatChannelMembers.channelId], references: [chatChannels.id] }),
  user: one(users, { fields: [chatChannelMembers.userId], references: [users.id] }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  channel: one(chatChannels, { fields: [chatMessages.channelId], references: [chatChannels.id] }),
  author: one(users, { fields: [chatMessages.authorId], references: [users.id] }),
}));
