CREATE TABLE "personal_feed_instructions" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "personal_feed_instructions_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "personal_feed_instructions" ADD CONSTRAINT "personal_feed_instructions_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;