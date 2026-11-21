import { pgTable, uuid, text, jsonb, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users, spaces } from "./schema";
import { EMPTY_TIMELINE } from "@/components/video-editor/types";
import type { TimelineData } from "@/components/video-editor/types";

export const videoJobStatusEnum = pgEnum("video_job_status", ["pending", "processing", "done", "failed"]);
export const videoResolutionEnum = pgEnum("video_resolution", ["720p", "1080p"]);

export const videoProjects = pgTable("video_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("Nouveau projet"),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  timelineJson: jsonb("timeline_json").notNull().default(EMPTY_TIMELINE).$type<TimelineData>(),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoJobs = pgTable("video_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  status: videoJobStatusEnum("status").notNull().default("pending"),
  resolution: videoResolutionEnum("resolution").notNull().default("720p"),
  outputKey: text("output_key"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VideoProject = typeof videoProjects.$inferSelect;
export type NewVideoProject = typeof videoProjects.$inferInsert;
export type VideoJob = typeof videoJobs.$inferSelect;
export type NewVideoJob = typeof videoJobs.$inferInsert;
