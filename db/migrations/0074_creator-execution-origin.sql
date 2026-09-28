ALTER TABLE "creator_previews" ADD COLUMN "source_session_id" text;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD COLUMN "source_turn_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_previews_source_idx" ON "creator_previews" USING btree ("source_session_id","source_turn_id");--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_source_check" CHECK (("creator_previews"."source_session_id" IS NULL) = ("creator_previews"."source_turn_id" IS NULL));