CREATE TABLE "creator_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"revision" uuid NOT NULL,
	"evaluation_revision" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"notes" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_releases_payload_check" CHECK (jsonb_typeof("creator_releases"."content") = 'object' AND octet_length("creator_releases"."content"::text) <= 65536
    AND jsonb_typeof("creator_releases"."evidence") = 'array' AND jsonb_array_length("creator_releases"."evidence") BETWEEN 1 AND 20
    AND octet_length("creator_releases"."evidence"::text) <= 2097152 AND length("creator_releases"."notes") BETWEEN 1 AND 8000)
);
--> statement-breakpoint
ALTER TABLE "creator_releases" ADD CONSTRAINT "creator_releases_draft_id_creator_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."creator_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_releases" ADD CONSTRAINT "creator_releases_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_releases_owner_idx" ON "creator_releases" USING btree ("workspace_id","user_id","created_at" DESC NULLS LAST);