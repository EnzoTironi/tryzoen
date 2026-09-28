CREATE TABLE "creator_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"content" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_drafts_content_check" CHECK (jsonb_typeof("creator_drafts"."content") = 'object' AND octet_length("creator_drafts"."content"::text) <= 4194304)
);
--> statement-breakpoint
ALTER TABLE "creator_drafts" ADD CONSTRAINT "creator_drafts_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_drafts_owner_idx" ON "creator_drafts" USING btree ("workspace_id","user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);