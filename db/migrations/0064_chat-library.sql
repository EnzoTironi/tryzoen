ALTER TABLE "chats" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "chats_library_page_idx" ON "chats" USING btree ("workspace_id","archived","pinned" DESC NULLS LAST,"updated_at" DESC NULLS LAST,"session_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_sessions_owner_idx" ON "agent_sessions" USING btree ("workspace_id","created_by_user_id","session_id");