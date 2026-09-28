CREATE TABLE "personal_feed_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"content" jsonb,
	"liked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_feed_posts" ADD CONSTRAINT "personal_feed_posts_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_feed_topic_idx" ON "personal_feed_posts" USING btree ("workspace_id","user_id","key");--> statement-breakpoint
CREATE INDEX "personal_feed_page_idx" ON "personal_feed_posts" USING btree ("workspace_id","user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);