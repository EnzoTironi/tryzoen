DROP INDEX "memory_session_sources_pending_idx";--> statement-breakpoint
DROP INDEX "memory_session_sources_owner_pending_idx";--> statement-breakpoint
ALTER TABLE "memory_session_sources" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_session_sources" ADD COLUMN "delivery_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_session_sources" ADD COLUMN "last_failed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "memory_session_sources_pending_idx" ON "memory_session_sources" USING btree ("available_at","capture_sequence") WHERE "memory_session_sources"."stored_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_session_sources_owner_pending_idx" ON "memory_session_sources" USING btree ("namespace_id","capture_sequence") WHERE "memory_session_sources"."stored_at" IS NULL;--> statement-breakpoint
ALTER TABLE "memory_session_sources" ADD CONSTRAINT "memory_session_source_failures" CHECK ("memory_session_sources"."delivery_failures" >= 0 AND ("memory_session_sources"."delivery_failures" = 0) = ("memory_session_sources"."last_failed_at" IS NULL));