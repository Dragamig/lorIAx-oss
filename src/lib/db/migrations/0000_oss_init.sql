CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TYPE "public"."attendee_role" AS ENUM('organizer', 'required', 'optional');--> statement-breakpoint
CREATE TYPE "public"."attendee_status" AS ENUM('accepted', 'declined', 'tentative', 'needs-action');--> statement-breakpoint
CREATE TYPE "public"."database_automation_action" AS ENUM('webhook', 'notify_user', 'create_row', 'update_row', 'send_email', 'ai', 'create_document', 'create_task', 'create_design');--> statement-breakpoint
CREATE TYPE "public"."database_automation_trigger" AS ENUM('row_created', 'row_updated', 'row_deleted', 'cron', 'date_reached', 'value_changed', 'manual', 'webhook_inbound', 'media_uploaded');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_type" AS ENUM('client', 'technical', 'full');--> statement-breakpoint
CREATE TYPE "public"."calendar_permission" AS ENUM('read', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "public"."calendar_type" AS ENUM('personal', 'team', 'organization');--> statement-breakpoint
CREATE TYPE "public"."classification_level" AS ENUM('public', 'internal', 'confidential', 'secret');--> statement-breakpoint
CREATE TYPE "public"."column_type" AS ENUM('text', 'number', 'date', 'formula', 'select', 'checkbox', 'relation', 'image', 'url', 'email', 'attachment', 'time', 'autonumber', 'person', 'document_link');--> statement-breakpoint
CREATE TYPE "public"."dashboard_widget_type" AS ENUM('kpi', 'bar', 'pie');--> statement-breakpoint
CREATE TYPE "public"."doc_visibility" AS ENUM('private', 'team', 'public');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('document', 'space', 'template', 'calendar_event', 'meeting', 'database');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('confirmed', 'tentative', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('public', 'private', 'confidential');--> statement-breakpoint
CREATE TYPE "public"."locale_enum" AS ENUM('fr', 'en', 'es', 'de', 'ja', 'zh', 'br');--> statement-breakpoint
CREATE TYPE "public"."meeting_room_booking_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."meeting_room_principal_type" AS ENUM('user', 'team', 'role');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'active', 'ended', 'transcribing', 'mapping', 'summarizing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('mention', 'comment', 'reply', 'share', 'calendar_reminder', 'calendar_invitation', 'meeting_room_cancelled', 'chat_message', 'task_assigned', 'automation', 'media');--> statement-breakpoint
CREATE TYPE "public"."permission_level" AS ENUM('viewer', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."reminder_type" AS ENUM('notification', 'email');--> statement-breakpoint
CREATE TYPE "public"."space_type" AS ENUM('personal', 'team', 'organization');--> statement-breakpoint
CREATE TYPE "public"."sync_mode" AS ENUM('manual', 'pull', 'bidirectional');--> statement-breakpoint
CREATE TYPE "public"."sync_provider" AS ENUM('airtable', 'notion');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('document_item', 'gantt_event', 'database_row');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_capability" AS ENUM('facility_manager', 'automation_manager', 'template_doc_editor', 'template_graphic_editor');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'editor', 'viewer', 'facility_manager', 'automation_manager', 'template_doc_editor', 'template_graphic_editor');--> statement-breakpoint
CREATE TYPE "public"."database_view_type" AS ENUM('grid', 'kanban', 'gallery', 'calendar', 'form', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."visio_action" AS ENUM('join_immediate', 'join_scheduled_invited', 'join_scheduled_uninvited', 'create_immediate', 'create_scheduled', 'modify_cancel');--> statement-breakpoint
CREATE TYPE "public"."ai_log_status" AS ENUM('success', 'error', 'timeout', 'fallback', 'quota_exceeded');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_type" AS ENUM('chat', 'summary_doc', 'summary_meeting', 'embeddings', 'playground', 'database_ai_create', 'database_ai_formula', 'automation_ai', 'help', 'voice_note_summary', 'voice_note_cleanup', 'rerank', 'chat_database_actions', 'creation');--> statement-breakpoint
CREATE TYPE "public"."connector_type" AS ENUM('anthropic', 'openai_compatible', 'mistral');--> statement-breakpoint
CREATE TYPE "public"."quota_period" AS ENUM('daily', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."quota_scope" AS ENUM('org', 'team', 'user');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."chat_channel_type" AS ENUM('direct', 'team', 'space');--> statement-breakpoint
CREATE TYPE "public"."video_job_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_resolution" AS ENUM('720p', '1080p');--> statement-breakpoint
CREATE TYPE "public"."voice_note_status" AS ENUM('recording', 'transcribing', 'review', 'validated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'pdf', 'document', 'video', 'audio', 'archive', 'other');--> statement-breakpoint
CREATE TYPE "public"."media_origin" AS ENUM('upload', 'stock', 'automation', 'studio');--> statement-breakpoint
CREATE TYPE "public"."media_usage_source" AS ENUM('content', 'explicit');--> statement-breakpoint
CREATE TYPE "public"."media_usage_target" AS ENUM('document', 'database_row', 'design', 'video_project', 'brand_kit', 'presentation', 'whiteboard');--> statement-breakpoint
CREATE TYPE "public"."row_change_kind" AS ENUM('created', 'updated', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."row_change_source" AS ENUM('ui', 'automation', 'import', 'public_form', 'sync', 'relation_sync', 'restore', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "public"."row_task_event_kind" AS ENUM('created', 'completed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_status" AS ENUM('pending', 'applying', 'applied', 'dismissed', 'stale', 'undone', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_type" AS ENUM('update_rows', 'delete_rows', 'merge_duplicates', 'create_rows');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"api_base_url" varchar(512),
	"api_key_enc" varchar(1024),
	"default_model" varchar(255),
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}',
	"connector_type" "connector_type" DEFAULT 'openai_compatible' NOT NULL,
	"pricing" jsonb,
	"icon" varchar(50),
	"color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"scopes" jsonb DEFAULT '[]' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(255) NOT NULL,
	"details" jsonb,
	"ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) NOT NULL,
	"duration_ms" integer,
	"error_message" text,
	"payload" jsonb,
	"steps" jsonb,
	"trace_truncated" boolean DEFAULT false NOT NULL,
	"source" varchar(20) DEFAULT 'trigger' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid,
	"space_id" uuid,
	"name" varchar(255) NOT NULL,
	"trigger_type" "database_automation_trigger" NOT NULL,
	"trigger_config" jsonb DEFAULT '{}' NOT NULL,
	"action_type" "database_automation_action" NOT NULL,
	"action_config" jsonb DEFAULT '{}' NOT NULL,
	"graph" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "backup_type" NOT NULL,
	"status" "backup_status" DEFAULT 'running' NOT NULL,
	"triggered_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"size_bytes" bigint,
	"s3_key" varchar(500),
	"s3_bucket" varchar(200),
	"error" text,
	"table_count" integer
);
--> statement-breakpoint
CREATE TABLE "calendar_event_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"email" varchar(320),
	"display_name" varchar(255),
	"role" "attendee_role" DEFAULT 'required' NOT NULL,
	"status" "attendee_status" DEFAULT 'needs-action' NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_event_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "reminder_type" DEFAULT 'notification' NOT NULL,
	"minutes_before" integer DEFAULT 15 NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"location" varchar(500),
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"recurrence_rule" varchar(500),
	"recurrence_exceptions" jsonb DEFAULT '[]',
	"status" "event_status" DEFAULT 'confirmed' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'public' NOT NULL,
	"uid" varchar(255) NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"parent_event_id" uuid,
	"depends_on_event_id" uuid,
	"color" varchar(7),
	"document_id" uuid,
	"meeting_id" uuid,
	"meeting_room_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE "calendar_external_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"color" varchar(7) DEFAULT '#6b7280' NOT NULL,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"color" varchar(7),
	"visible" boolean DEFAULT true NOT NULL,
	"notifications" boolean DEFAULT true NOT NULL,
	"permission" "calendar_permission" DEFAULT 'read' NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"color" varchar(7) DEFAULT '#3b82f6' NOT NULL,
	"timezone" varchar(100) DEFAULT 'Europe/Paris' NOT NULL,
	"type" "calendar_type" DEFAULT 'personal' NOT NULL,
	"owner_user_id" uuid,
	"owner_team_id" uuid,
	"space_id" uuid,
	"organization_id" uuid,
	"caldav_slug" varchar(255) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendars_caldav_slug_unique" UNIQUE("caldav_slug")
);
--> statement-breakpoint
CREATE TABLE "dashboard_widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"type" "dashboard_widget_type" NOT NULL,
	"title" varchar(255) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"size" varchar(10) DEFAULT 'half' NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_id" text NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_snapshots_design_id_unique" UNIQUE("design_id")
);
--> statement-breakpoint
CREATE TABLE "design_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"content" jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]' NOT NULL,
	"category" varchar(100),
	"created_by" uuid NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"space_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_collab_states" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"yjs_state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"parent_id" uuid,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"model" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_labels" (
	"document_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "document_labels_document_id_label_id_pk" PRIMARY KEY("document_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"link_text" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_links_source_id_target_id_pk" PRIMARY KEY("source_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "document_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"level" "permission_level" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" varchar(500) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"file_path" varchar(1024) NOT NULL,
	"visibility" "doc_visibility" DEFAULT 'team' NOT NULL,
	"classification" "classification_level" DEFAULT 'internal' NOT NULL,
	"is_folder" boolean DEFAULT false NOT NULL,
	"template_id" uuid,
	"created_by" uuid NOT NULL,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"icon" varchar(50),
	"position" integer DEFAULT 0 NOT NULL,
	"content_text" text,
	"properties" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "event_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_event_id" uuid NOT NULL,
	"target_event_id" uuid NOT NULL,
	"type" varchar(20) DEFAULT 'finish-to-start' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_database_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_database_id" uuid NOT NULL,
	"provider" "sync_provider" NOT NULL,
	"external_id" varchar(512) NOT NULL,
	"config" jsonb DEFAULT '{}',
	"credentials_enc" varchar(2048),
	"sync_mode" "sync_mode" DEFAULT 'manual' NOT NULL,
	"sync_interval_min" integer,
	"column_mapping" jsonb DEFAULT '{}',
	"last_sync_at" timestamp with time zone,
	"last_sync_direction" varchar(20),
	"is_syncing" boolean DEFAULT false NOT NULL,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_row_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_id" uuid NOT NULL,
	"loriax_row_id" uuid NOT NULL,
	"external_row_id" varchar(512) NOT NULL,
	"content_hash" varchar(64),
	"last_external_change_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"provider_type" varchar(50) DEFAULT 'custom' NOT NULL,
	"base_url" varchar(500),
	"api_key_enc" varchar(1024),
	"is_enabled" boolean DEFAULT false NOT NULL,
	"organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(7) DEFAULT '#6b7280' NOT NULL,
	"space_id" uuid,
	"is_global" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" varchar(100) NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meeting_room_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"attendees" jsonb DEFAULT '[]' NOT NULL,
	"status" "meeting_room_booking_status" DEFAULT 'confirmed' NOT NULL,
	"calendar_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_room_permissions" (
	"room_id" uuid NOT NULL,
	"principal_type" "meeting_room_principal_type" NOT NULL,
	"principal_id" varchar(64) NOT NULL,
	"can_book" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_room_permissions_room_id_principal_type_principal_id_pk" PRIMARY KEY("room_id","principal_type","principal_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"floor" varchar(100),
	"capacity" integer DEFAULT 0 NOT NULL,
	"description" text,
	"photo_key" varchar(512),
	"floor_plan_key" varchar(512),
	"organization_id" uuid,
	"opening_hours" jsonb DEFAULT '{"mon":[{"from":"08:00","to":"19:00"}],"tue":[{"from":"08:00","to":"19:00"}],"wed":[{"from":"08:00","to":"19:00"}],"thu":[{"from":"08:00","to":"19:00"}],"fri":[{"from":"08:00","to":"19:00"}],"sat":[],"sun":[]}' NOT NULL,
	"equipment" jsonb DEFAULT '[]' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"room_name" varchar(100) NOT NULL,
	"space_id" uuid,
	"document_id" uuid,
	"notes_document_id" uuid,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"egress_id" varchar(255),
	"recording_path" varchar(512),
	"transcript_path" varchar(512),
	"meeting_type" varchar(20) DEFAULT 'video' NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb,
	"speaker_mapping" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"calendar_event_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_room_name_unique" UNIQUE("room_name")
);
--> statement-breakpoint
CREATE TABLE "mindmap_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mindmap_id" text NOT NULL,
	"document_id" uuid,
	"data" text NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mindmap_snapshots_mindmap_id_unique" UNIQUE("mindmap_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(500) NOT NULL,
	"message" text,
	"document_id" uuid,
	"actor_id" uuid,
	"database_id" uuid,
	"row_id" uuid,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"current_step" integer DEFAULT 0 NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bonus_steps" jsonb DEFAULT '{"docAdvanced":{},"goFurther":{}}'::jsonb NOT NULL,
	"badges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "public_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "shared_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(255),
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"level" "permission_level" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"type" "space_type" DEFAULT 'personal' NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"owner_team_id" uuid,
	"git_repo_path" varchar(512) NOT NULL,
	"classification" "classification_level" DEFAULT 'internal' NOT NULL,
	"icon" varchar(50),
	"appearance_preset" jsonb,
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" text NOT NULL,
	"space_id" uuid,
	"data" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spreadsheet_data_sheet_id_unique" UNIQUE("sheet_id")
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_id" uuid NOT NULL,
	"direction" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"rows_created" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_deleted" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "task_kind" NOT NULL,
	"title" varchar(500) NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"assignee_id" uuid,
	"created_by" uuid NOT NULL,
	"document_id" uuid,
	"node_id" varchar(100),
	"calendar_event_id" uuid,
	"database_id" uuid,
	"row_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_database_row_ctx" CHECK ("tasks"."kind" <> 'database_row' OR ("tasks"."database_id" IS NOT NULL AND "tasks"."row_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"content" jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]' NOT NULL,
	"icon" varchar(50),
	"category" varchar(100),
	"created_by" uuid NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"space_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_database_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "column_type" DEFAULT 'text' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_database_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"icon" varchar(64),
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_database_recents" (
	"user_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_database_recents_user_id_database_id_pk" PRIMARY KEY("user_id","database_id")
);
--> statement-breakpoint
CREATE TABLE "user_database_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"cells" jsonb DEFAULT '{}' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_database_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "database_view_type" NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_token" varchar(64),
	"position" integer DEFAULT 0 NOT NULL,
	"scope" varchar(16) DEFAULT 'shared' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_database_views_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "user_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"group_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"icon" varchar(64),
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_status" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"custom_emoji" text,
	"custom_text" varchar(100),
	"custom_expires_at" timestamp with time zone,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_whiteboard_library" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"library_items" jsonb DEFAULT '[]' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"avatar_url" varchar(512),
	"global_role" "user_role" DEFAULT 'editor' NOT NULL,
	"capabilities" "user_capability"[] DEFAULT '{}'::user_capability[] NOT NULL,
	"locale" "locale_enum" DEFAULT 'fr' NOT NULL,
	"ldap_dn" varchar(512),
	"theme_preferences" jsonb DEFAULT '{}',
	"token_invalidated_at" timestamp with time zone,
	"must_reset_password" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "visio_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid,
	"action" "visio_action" NOT NULL,
	"role" "permission_level" NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"response_body" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid,
	"url" varchar(2048) NOT NULL,
	"events" jsonb DEFAULT '[]' NOT NULL,
	"secret" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid
);
--> statement-breakpoint
CREATE TABLE "whiteboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" text NOT NULL,
	"document_id" uuid,
	"snapshot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whiteboard_snapshots_canvas_id_unique" UNIQUE("canvas_id")
);
--> statement-breakpoint
CREATE TABLE "ai_model_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage_type" "ai_usage_type" NOT NULL,
	"provider_id" uuid NOT NULL,
	"model" varchar(255) NOT NULL,
	"fallback_provider_id" uuid,
	"fallback_model" varchar(255),
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"max_retries" integer DEFAULT 1 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_assignments_usage_type_unique" UNIQUE("usage_type")
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text,
	"variables" jsonb DEFAULT '[]',
	"is_active" boolean DEFAULT false NOT NULL,
	"traffic_percentage" integer DEFAULT 100 NOT NULL,
	"change_note" varchar(500) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"usage_type" "ai_usage_type" NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_prompts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ai_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "quota_scope" NOT NULL,
	"scope_id" uuid,
	"period" "quota_period" DEFAULT 'monthly' NOT NULL,
	"max_tokens" bigint,
	"max_requests" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"provider_id" uuid,
	"model" varchar(255),
	"usage_type" "ai_usage_type" NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"status" "ai_log_status" NOT NULL,
	"error_message" text,
	"fallback_provider_id" uuid,
	"prompt_version_id" uuid,
	"cost_estimate" numeric(10, 6),
	"request_body" text,
	"response_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"font_heading" varchar(100),
	"font_body" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kits_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"plan" varchar(50) DEFAULT 'free' NOT NULL,
	"plan_expires_at" timestamp with time zone,
	"previous_plan" varchar(50),
	"license_key" varchar(512),
	"max_users" integer DEFAULT 5,
	"max_spaces" integer DEFAULT 2,
	"is_active" boolean DEFAULT true NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"subscription_status" varchar(50) DEFAULT 'inactive',
	"trial_ends_at" timestamp with time zone,
	"max_storage_gb" numeric(6, 2) DEFAULT '1',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "chat_channel_members" (
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_channel_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "chat_channel_type" NOT NULL,
	"team_id" uuid,
	"space_id" uuid,
	"name" varchar(255),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_id" uuid,
	"content" text,
	"document_ref" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(255) NOT NULL,
	"title" varchar(500),
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"model" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "video_job_status" DEFAULT 'pending' NOT NULL,
	"resolution" "video_resolution" DEFAULT '720p' NOT NULL,
	"output_key" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'Nouveau projet' NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"timeline_json" jsonb DEFAULT '{"tracks":[{"type":"video","id":"video-1","name":"Vidéo 1","clips":[]},{"type":"audio","id":"audio-1","name":"Audio 1","clips":[]},{"type":"subtitle","id":"subtitles","name":"Textes","clips":[]}],"durationMs":0}'::jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "voice_note_status" DEFAULT 'recording' NOT NULL,
	"audio_path" varchar(1024),
	"duration_seconds" integer,
	"transcript" text,
	"transcript_validated_at" timestamp with time zone,
	"summary" text,
	"cleaned_text" text,
	"summary_transcript_hash" varchar(64),
	"cleaned_transcript_hash" varchar(64),
	"processing_kind" varchar(16),
	"processing_started_at" timestamp with time zone,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally_connections" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"key_suffix" varchar(8) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally_import_items" (
	"import_id" uuid NOT NULL,
	"submission_id" varchar(128) NOT NULL,
	"position" integer NOT NULL,
	"name" varchar(200),
	"email" varchar(200),
	"outcome" varchar(10) NOT NULL,
	"filled_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"run_id" uuid,
	"trace" jsonb,
	"trace_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tally_import_items_import_id_submission_id_pk" PRIMARY KEY("import_id","submission_id")
);
--> statement-breakpoint
CREATE TABLE "tally_imported_submissions" (
	"automation_id" uuid NOT NULL,
	"submission_id" varchar(128) NOT NULL,
	"import_id" uuid,
	"state" varchar(10) DEFAULT 'done' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tally_imported_submissions_automation_id_submission_id_pk" PRIMARY KEY("automation_id","submission_id")
);
--> statement-breakpoint
CREATE TABLE "tally_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"form_id" varchar(64) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"since" timestamp with time zone,
	"cap" integer NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"started_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid,
	"folder_id" uuid,
	"document_id" uuid,
	"filename" varchar(500) NOT NULL,
	"title" varchar(500),
	"alt_text" varchar(500),
	"description" text,
	"mime_type" varchar(255) NOT NULL,
	"kind" "media_kind" NOT NULL,
	"origin" "media_origin" DEFAULT 'upload' NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"checksum_sha256" char(64),
	"width" integer,
	"height" integer,
	"page_count" integer,
	"thumbnail_key" varchar(1024),
	"current_version" integer DEFAULT 1 NOT NULL,
	"source_media_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(200) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_tag_links" (
	"media_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_tag_links_media_id_tag_id_pk" PRIMARY KEY("media_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "media_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"target_type" "media_usage_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"context" varchar(120),
	"source" "media_usage_source" DEFAULT 'content' NOT NULL,
	"space_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"thumbnail_key" varchar(1024),
	"filename" varchar(500) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" char(64),
	"width" integer,
	"height" integer,
	"page_count" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text,
	"restored_from" integer
);
--> statement-breakpoint
CREATE TABLE "media_multipart_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid,
	"folder_id" uuid,
	"filename" varchar(500) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"part_size" integer NOT NULL,
	"s3_upload_id" varchar(1024) NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_ai_daily_usage" (
	"organization_id" uuid NOT NULL,
	"day" date NOT NULL,
	"transcribe_seconds" integer DEFAULT 0 NOT NULL,
	"indexed_passes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_ai_daily_usage_organization_id_day_pk" PRIMARY KEY("organization_id","day")
);
--> statement-breakpoint
CREATE TABLE "media_ai_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"index_enabled" boolean DEFAULT false NOT NULL,
	"transcribe_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"model" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"reason" varchar(32),
	"source" varchar(16),
	"text" text,
	"text_chars" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_texts_media" UNIQUE("media_id")
);
--> statement-breakpoint
CREATE TABLE "database_row_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"kind" "row_change_kind" NOT NULL,
	"source" "row_change_source" NOT NULL,
	"actor_user_id" uuid,
	"actor_label" varchar(120),
	"automation_id" uuid,
	"batch_id" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_row_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "database_row_task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"kind" "row_task_event_kind" NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_connections" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"contacts_database_id" uuid,
	"deals_database_id" uuid,
	"interactions_database_id" uuid,
	"created_database_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_automation_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"field_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'Nouvelle présentation' NOT NULL,
	"space_id" uuid,
	"organization_id" uuid,
	"is_template" boolean DEFAULT false NOT NULL,
	"template_description" text,
	"template_origin" text,
	"template_seed_key" text,
	"template_hidden_at" timestamp with time zone,
	"document_id" uuid,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"slide_count" integer DEFAULT 0 NOT NULL,
	"thumbnail_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presentations_space_or_template_chk" CHECK (space_id IS NOT NULL OR is_template)
);
--> statement-breakpoint
CREATE TABLE "mail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"address" varchar(320) NOT NULL,
	"display_name" varchar(255) DEFAULT '' NOT NULL,
	"smtp_host" varchar(255) NOT NULL,
	"smtp_port" integer NOT NULL,
	"smtp_security" varchar(16) NOT NULL,
	"imap_host" varchar(255) NOT NULL,
	"imap_port" integer NOT NULL,
	"imap_security" varchar(16) NOT NULL,
	"password_enc" text,
	"signature" text DEFAULT '' NOT NULL,
	"cancel_delay_seconds" integer DEFAULT 10 NOT NULL,
	"poll_interval_minutes" integer DEFAULT 5 NOT NULL,
	"last_poll_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'unverified' NOT NULL,
	"status_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid,
	"user_id" uuid NOT NULL,
	"direction" varchar(8) NOT NULL,
	"status" varchar(16) NOT NULL,
	"message_id" varchar(998),
	"in_reply_to" varchar(998),
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"thread_key" varchar(998),
	"from_address" varchar(320) NOT NULL,
	"to_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"bcc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"trace_attempts" integer DEFAULT 0 NOT NULL,
	"client_key" varchar(64),
	"contact_database_id" uuid,
	"contact_row_id" uuid,
	"dossier_database_id" uuid,
	"dossier_row_id" uuid,
	"interaction_row_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"type" "ai_proposal_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"freshness" jsonb NOT NULL,
	"status" "ai_proposal_status" DEFAULT 'pending' NOT NULL,
	"undo_snapshot" jsonb,
	"batch_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"replaces_id" uuid,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tool" varchar(100) NOT NULL,
	"args" jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"duration_ms" integer NOT NULL,
	"proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_creation_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid,
	"kind" varchar(20) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"result_id" uuid,
	"result_type" varchar(20),
	"overrides" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_parent_event_id_calendar_events_id_fk" FOREIGN KEY ("parent_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_depends_on_event_id_calendar_events_id_fk" FOREIGN KEY ("depends_on_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_meeting_room_id_meeting_rooms_id_fk" FOREIGN KEY ("meeting_room_id") REFERENCES "public"."meeting_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_external_feeds" ADD CONSTRAINT "calendar_external_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_snapshots" ADD CONSTRAINT "design_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_templates" ADD CONSTRAINT "design_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_templates" ADD CONSTRAINT "design_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_collab_states" ADD CONSTRAINT "document_collab_states_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_parent_id_document_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_labels" ADD CONSTRAINT "document_labels_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_labels" ADD CONSTRAINT "document_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_source_id_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_target_id_documents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_id_documents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_dependencies" ADD CONSTRAINT "event_dependencies_source_event_id_calendar_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_dependencies" ADD CONSTRAINT "event_dependencies_target_event_id_calendar_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_database_mappings" ADD CONSTRAINT "external_database_mappings_user_database_id_user_databases_id_fk" FOREIGN KEY ("user_database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_row_tracking" ADD CONSTRAINT "external_row_tracking_mapping_id_external_database_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."external_database_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_row_tracking" ADD CONSTRAINT "external_row_tracking_loriax_row_id_user_database_rows_id_fk" FOREIGN KEY ("loriax_row_id") REFERENCES "public"."user_database_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_providers" ADD CONSTRAINT "image_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_room_bookings" ADD CONSTRAINT "meeting_room_bookings_room_id_meeting_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."meeting_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_room_bookings" ADD CONSTRAINT "meeting_room_bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_room_bookings" ADD CONSTRAINT "meeting_room_bookings_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_room_permissions" ADD CONSTRAINT "meeting_room_permissions_room_id_meeting_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."meeting_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_rooms" ADD CONSTRAINT "meeting_rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_rooms" ADD CONSTRAINT "meeting_rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_notes_document_id_documents_id_fk" FOREIGN KEY ("notes_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mindmap_snapshots" ADD CONSTRAINT "mindmap_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_shares" ADD CONSTRAINT "public_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_shares" ADD CONSTRAINT "public_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_presets" ADD CONSTRAINT "shared_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_data" ADD CONSTRAINT "spreadsheet_data_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_mapping_id_external_database_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."external_database_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_columns" ADD CONSTRAINT "user_database_columns_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_groups" ADD CONSTRAINT "user_database_groups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_groups" ADD CONSTRAINT "user_database_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_recents" ADD CONSTRAINT "user_database_recents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_recents" ADD CONSTRAINT "user_database_recents_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_rows" ADD CONSTRAINT "user_database_rows_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_views" ADD CONSTRAINT "user_database_views_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_database_views" ADD CONSTRAINT "user_database_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_databases" ADD CONSTRAINT "user_databases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_databases" ADD CONSTRAINT "user_databases_group_id_user_database_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_database_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_databases" ADD CONSTRAINT "user_databases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_status" ADD CONSTRAINT "user_status_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_whiteboard_library" ADD CONSTRAINT "user_whiteboard_library_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visio_permissions" ADD CONSTRAINT "visio_permissions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_snapshots" ADD CONSTRAINT "whiteboard_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_document_ref_documents_id_fk" FOREIGN KEY ("document_ref") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_notes" ADD CONSTRAINT "voice_notes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_notes" ADD CONSTRAINT "voice_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connections" ADD CONSTRAINT "tally_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connections" ADD CONSTRAINT "tally_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_import_items" ADD CONSTRAINT "tally_import_items_import_id_tally_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."tally_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_imported_submissions" ADD CONSTRAINT "tally_imported_submissions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_imported_submissions" ADD CONSTRAINT "tally_imported_submissions_import_id_tally_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."tally_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_imports" ADD CONSTRAINT "tally_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_imports" ADD CONSTRAINT "tally_imports_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_imports" ADD CONSTRAINT "tally_imports_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_folder_id_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_source_media_id_media_id_fk" FOREIGN KEY ("source_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parent_id_media_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_tag_links" ADD CONSTRAINT "media_tag_links_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_tag_links" ADD CONSTRAINT "media_tag_links_tag_id_media_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."media_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_tags" ADD CONSTRAINT "media_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_multipart_uploads" ADD CONSTRAINT "media_multipart_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_multipart_uploads" ADD CONSTRAINT "media_multipart_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_multipart_uploads" ADD CONSTRAINT "media_multipart_uploads_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_multipart_uploads" ADD CONSTRAINT "media_multipart_uploads_folder_id_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_saved_views" ADD CONSTRAINT "media_saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_saved_views" ADD CONSTRAINT "media_saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_ai_daily_usage" ADD CONSTRAINT "media_ai_daily_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_ai_settings" ADD CONSTRAINT "media_ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_ai_settings" ADD CONSTRAINT "media_ai_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_embeddings" ADD CONSTRAINT "media_embeddings_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_embeddings" ADD CONSTRAINT "media_embeddings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_embeddings" ADD CONSTRAINT "media_embeddings_media_text_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media_texts"("media_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_texts" ADD CONSTRAINT "media_texts_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_texts" ADD CONSTRAINT "media_texts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_changes" ADD CONSTRAINT "database_row_changes_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_changes" ADD CONSTRAINT "database_row_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_comments" ADD CONSTRAINT "database_row_comments_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_comments" ADD CONSTRAINT "database_row_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_task_events" ADD CONSTRAINT "database_row_task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_task_events" ADD CONSTRAINT "database_row_task_events_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_task_events" ADD CONSTRAINT "database_row_task_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_contacts_database_id_user_databases_id_fk" FOREIGN KEY ("contacts_database_id") REFERENCES "public"."user_databases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_deals_database_id_user_databases_id_fk" FOREIGN KEY ("deals_database_id") REFERENCES "public"."user_databases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_interactions_database_id_user_databases_id_fk" FOREIGN KEY ("interactions_database_id") REFERENCES "public"."user_databases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_database_id_user_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."user_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_creation_proposals" ADD CONSTRAINT "ai_creation_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_creation_proposals" ADD CONSTRAINT "ai_creation_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_creation_proposals" ADD CONSTRAINT "ai_creation_proposals_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_entity" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_activity_user" ON "activity_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ai_providers_org" ON "ai_providers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_user" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_prefix" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_user_database_automation_runs_automation" ON "automation_runs" USING btree ("automation_id","triggered_at");--> statement-breakpoint
CREATE INDEX "idx_user_database_automations_database" ON "automations" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "idx_user_database_automations_space" ON "automations" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "backup_jobs_status_idx" ON "backup_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "backup_jobs_type_idx" ON "backup_jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "backup_jobs_started_at_idx" ON "backup_jobs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_event_attendees_event" ON "calendar_event_attendees" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_attendees_user" ON "calendar_event_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_event_reminders_event" ON "calendar_event_reminders" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_reminders_user" ON "calendar_event_reminders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_event_reminders_pending" ON "calendar_event_reminders" USING btree ("sent","event_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_calendar" ON "calendar_events" USING btree ("calendar_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_start" ON "calendar_events" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_end" ON "calendar_events" USING btree ("end_at");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_range" ON "calendar_events" USING btree ("calendar_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_parent" ON "calendar_events" USING btree ("parent_event_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_uid" ON "calendar_events" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_meeting" ON "calendar_events" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_meeting_room" ON "calendar_events" USING btree ("meeting_room_id");--> statement-breakpoint
CREATE INDEX "idx_external_feeds_user" ON "calendar_external_feeds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_subs_user" ON "calendar_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_subs_calendar" ON "calendar_subscriptions" USING btree ("calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_calendar_subs_unique" ON "calendar_subscriptions" USING btree ("user_id","calendar_id");--> statement-breakpoint
CREATE INDEX "idx_calendars_owner_user" ON "calendars" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_calendars_owner_team" ON "calendars" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "idx_calendars_space" ON "calendars" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_calendars_org" ON "calendars" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_dashboard_widgets_dashboard" ON "dashboard_widgets" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "idx_dashboards_space" ON "dashboards" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_design_snapshots_document" ON "design_snapshots" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_comments_document" ON "document_comments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_comments_parent" ON "document_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_embeddings_doc_chunk" ON "document_embeddings" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "idx_doc_labels_document" ON "document_labels" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_links_source" ON "document_links" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_links_target" ON "document_links" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "idx_doc_perm_document" ON "document_permissions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_documents_space_path" ON "documents" USING btree ("space_id","file_path");--> statement-breakpoint
CREATE INDEX "idx_documents_parent" ON "documents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_documents_space" ON "documents" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_documents_updated" ON "documents" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_documents_slug" ON "documents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_documents_created_by" ON "documents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_email_verification_user" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_event_deps" ON "event_dependencies" USING btree ("source_event_id","target_event_id");--> statement-breakpoint
CREATE INDEX "idx_event_deps_source" ON "event_dependencies" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "idx_event_deps_target" ON "event_dependencies" USING btree ("target_event_id");--> statement-breakpoint
CREATE INDEX "idx_ext_db_mappings_user_db" ON "external_database_mappings" USING btree ("user_database_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ext_db_mappings_unique" ON "external_database_mappings" USING btree ("user_database_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracking_unique" ON "external_row_tracking" USING btree ("mapping_id","loriax_row_id");--> statement-breakpoint
CREATE INDEX "idx_tracking_external_id" ON "external_row_tracking" USING btree ("mapping_id","external_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_favorites_unique" ON "favorites" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_favorites_user_position" ON "favorites" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "idx_image_providers_org" ON "image_providers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_image_providers_org_name" ON "image_providers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "idx_labels_space" ON "labels" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "meeting_participants_meeting_id_idx" ON "meeting_participants" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "idx_meeting_room_bookings_room_range" ON "meeting_room_bookings" USING btree ("room_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "idx_meeting_room_bookings_user" ON "meeting_room_bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_meeting_room_bookings_status" ON "meeting_room_bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_meeting_room_bookings_event" ON "meeting_room_bookings" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE INDEX "idx_meeting_room_perms_principal" ON "meeting_room_permissions" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "idx_meeting_room_perms_room" ON "meeting_room_permissions" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "idx_meeting_rooms_active" ON "meeting_rooms" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_meeting_rooms_name" ON "meeting_rooms" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_meeting_rooms_org" ON "meeting_rooms" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "meetings_space_id_idx" ON "meetings" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "meetings_created_by_idx" ON "meetings" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "meetings_status_idx" ON "meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meetings_calendar_event_id_idx" ON "meetings" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE INDEX "idx_mindmap_snapshots_document" ON "mindmap_snapshots" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_read" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "idx_reset_tokens_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reset_tokens_token" ON "password_reset_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_public_shares_document" ON "public_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_public_shares_token" ON "public_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_shared_presets_user" ON "shared_presets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_space_perm_space" ON "space_permissions" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_space_perm_user" ON "space_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_spaces_org" ON "spaces" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_spreadsheet_data_sheet_id" ON "spreadsheet_data" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "idx_spreadsheet_data_space_id" ON "spreadsheet_data" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_mapping" ON "sync_logs" USING btree ("mapping_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_database_row" ON "tasks" USING btree ("database_id","row_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_assignee_status" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_document" ON "tasks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_calendar_event" ON "tasks" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_document_node" ON "tasks" USING btree ("document_id","node_id");--> statement-breakpoint
CREATE INDEX "idx_teams_org" ON "teams" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_user_db_columns_database" ON "user_database_columns" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "idx_user_database_groups_space" ON "user_database_groups" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_user_database_recents_opened" ON "user_database_recents" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE INDEX "idx_user_db_rows_database" ON "user_database_rows" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "idx_user_database_views_database" ON "user_database_views" USING btree ("database_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_database_views_name_shared" ON "user_database_views" USING btree ("database_id","name") WHERE "user_database_views"."scope" = 'shared';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_database_views_name_personal" ON "user_database_views" USING btree ("database_id","created_by","name") WHERE "user_database_views"."scope" = 'personal';--> statement-breakpoint
CREATE INDEX "idx_user_databases_space" ON "user_databases" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_user_databases_group" ON "user_databases" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_user_databases_space_status" ON "user_databases" USING btree ("space_id","archived_at","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_user_status_last_seen" ON "user_status" USING btree ("last_seen");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_visio_perm" ON "visio_permissions" USING btree ("space_id","action","role");--> statement-breakpoint
CREATE INDEX "idx_visio_perm_space" ON "visio_permissions" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_webhook" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_retry" ON "webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "idx_webhooks_user" ON "webhooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_webhooks_active" ON "webhooks" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_webhooks_org" ON "webhooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_whiteboard_snapshots_document" ON "whiteboard_snapshots" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_org_members_user" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_members_user" ON "chat_channel_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_channels_org" ON "chat_channels" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_chat_channels_team" ON "chat_channels" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_chat_channels_space" ON "chat_channels" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_channel_time" ON "chat_messages" USING btree ("channel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_kb_chunks_source_chunk" ON "kb_chunks" USING btree ("source","chunk_index");--> statement-breakpoint
CREATE INDEX "voice_notes_document_id_idx" ON "voice_notes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_tally_import_items_order" ON "tally_import_items" USING btree ("import_id","position");--> statement-breakpoint
CREATE INDEX "idx_tally_import_items_created" ON "tally_import_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tally_imports_automation" ON "tally_imports" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tally_imports_active" ON "tally_imports" USING btree ("automation_id") WHERE "tally_imports"."status" in ('pending','running');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_storage_key" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "idx_media_org_list" ON "media" USING btree ("organization_id","deleted_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_media_org_space" ON "media" USING btree ("organization_id","space_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_media_folder" ON "media" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_media_kind" ON "media" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_media_checksum" ON "media" USING btree ("checksum_sha256");--> statement-breakpoint
CREATE INDEX "idx_media_uploaded_by" ON "media" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "idx_media_source" ON "media" USING btree ("source_media_id") WHERE "media"."source_media_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_media_no_space" ON "media" USING btree ("organization_id") WHERE "media"."space_id" is null;--> statement-breakpoint
CREATE INDEX "idx_media_filename_trgm" ON "media" USING gin ("filename" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_media_title_trgm" ON "media" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_folders_name" ON "media_folders" USING btree ("organization_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"name");--> statement-breakpoint
CREATE INDEX "idx_media_folders_parent" ON "media_folders" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE INDEX "idx_media_tag_links_tag" ON "media_tag_links" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_tags_slug" ON "media_tags" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_usages_slot" ON "media_usages" USING btree ("media_id","target_type","target_id",coalesce("context", ''));--> statement-breakpoint
CREATE INDEX "idx_media_usages_target" ON "media_usages" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_media_usages_media" ON "media_usages" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_versions_media_version" ON "media_versions" USING btree ("media_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_versions_storage_key" ON "media_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "idx_media_versions_media" ON "media_versions" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "idx_media_multipart_status_expires" ON "media_multipart_uploads" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_media_multipart_org_user" ON "media_multipart_uploads" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_saved_views_user_name" ON "media_saved_views" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "idx_media_saved_views_org" ON "media_saved_views" USING btree ("organization_id","shared");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_embeddings_media_chunk" ON "media_embeddings" USING btree ("media_id","chunk_index");--> statement-breakpoint
CREATE INDEX "idx_media_embeddings_org" ON "media_embeddings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_media_texts_queue" ON "media_texts" USING btree ("next_attempt_at") WHERE "media_texts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_media_texts_org_status" ON "media_texts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_row_changes_row" ON "database_row_changes" USING btree ("database_id","row_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_row_changes_batch" ON "database_row_changes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_row_changes_deleted" ON "database_row_changes" USING btree ("database_id","row_id","created_at") WHERE "database_row_changes"."kind" = 'deleted';--> statement-breakpoint
CREATE INDEX "idx_row_comments_row" ON "database_row_comments" USING btree ("database_id","row_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_row_comments_deleted" ON "database_row_comments" USING btree ("deleted_at") WHERE "database_row_comments"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "idx_row_task_events_row" ON "database_row_task_events" USING btree ("database_id","row_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_row_task_events_task" ON "database_row_task_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_presentations_space" ON "presentations" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_presentations_document" ON "presentations" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_presentations_template_seed" ON "presentations" USING btree ("organization_id","template_seed_key") WHERE "presentations"."template_seed_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_presentations_org_templates" ON "presentations" USING btree ("organization_id") WHERE "presentations"."is_template";--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_org_user_idx" ON "mail_accounts" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_mail_messages_contact" ON "mail_messages" USING btree ("organization_id","contact_row_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_mail_messages_dossier" ON "mail_messages" USING btree ("organization_id","dossier_row_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_mail_messages_due" ON "mail_messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_mail_messages_thread" ON "mail_messages" USING btree ("organization_id","thread_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_account_message_id_idx" ON "mail_messages" USING btree ("account_id","message_id") WHERE "mail_messages"."message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_account_client_key_idx" ON "mail_messages" USING btree ("account_id","client_key");--> statement-breakpoint
CREATE INDEX "idx_ai_proposals_user_status" ON "ai_proposals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_ai_proposals_expires" ON "ai_proposals" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_ai_tool_calls_org_created" ON "ai_tool_calls" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_creation_proposals_org_user_status" ON "ai_creation_proposals" USING btree ("org_id","user_id","status");