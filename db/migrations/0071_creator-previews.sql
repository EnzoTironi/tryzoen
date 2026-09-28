CREATE TABLE "creator_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"revision" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"question" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invocation" text,
	"response" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone DEFAULT now() + interval '5 minutes' NOT NULL,
	CONSTRAINT "creator_previews_payload_check" CHECK (jsonb_typeof("creator_previews"."snapshot") = 'object' AND octet_length("creator_previews"."snapshot"::text) <= 65536 AND length("creator_previews"."question") BETWEEN 1 AND 4000),
	CONSTRAINT "creator_previews_state_check" CHECK ("creator_previews"."status" IN ('pending', 'running', 'completed', 'failed') AND (("creator_previews"."status" = 'completed') = ("creator_previews"."response" IS NOT NULL)) AND length("creator_previews"."response") <= 32000 AND ("creator_previews"."status" = 'pending' OR "creator_previews"."invocation" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_draft_id_creator_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."creator_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_previews" ADD CONSTRAINT "creator_previews_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_previews_owner_idx" ON "creator_previews" USING btree ("workspace_id","user_id","created_at" DESC NULLS LAST);