CREATE TABLE "personal_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"proposal" jsonb NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"feedback" text,
	"session_id" text,
	"start_auth_session_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"status_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_ideas" ADD CONSTRAINT "personal_ideas_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_ideas_topic_idx" ON "personal_ideas" USING btree ("workspace_id","user_id","key");--> statement-breakpoint
CREATE INDEX "personal_ideas_page_idx" ON "personal_ideas" USING btree ("workspace_id","user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "personal_ideas_session_idx" ON "personal_ideas" USING btree ("session_id");