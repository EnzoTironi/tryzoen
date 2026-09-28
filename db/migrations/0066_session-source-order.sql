DROP INDEX "memory_session_sources_pending_idx";--> statement-breakpoint
ALTER TABLE "memory_session_sources" ADD COLUMN "capture_sequence" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "memory_session_sources_pending_idx" ON "memory_session_sources" USING btree ("capture_sequence") WHERE "memory_session_sources"."stored_at" IS NULL;