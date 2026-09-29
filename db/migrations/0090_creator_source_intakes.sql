CREATE TABLE "creator_source_intakes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"draft_revision" uuid NOT NULL,
	"session_id" text NOT NULL,
	"armed_turn_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"source_id" uuid,
	"failure" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone DEFAULT now()+interval '15 minutes' NOT NULL,
	CONSTRAINT "creator_source_intakes_state_check" CHECK ("creator_source_intakes"."status" IN ('waiting','acquired','cancelled','expired','rejected') AND ("creator_source_intakes"."status"='acquired')=("creator_source_intakes"."source_id" IS NOT NULL) AND ("creator_source_intakes"."status"='rejected')=("creator_source_intakes"."failure" IS NOT NULL) AND length("creator_source_intakes"."title") BETWEEN 1 AND 120 AND length("creator_source_intakes"."session_id") BETWEEN 1 AND 200 AND ("creator_source_intakes"."failure" IS NULL OR length("creator_source_intakes"."failure") <= 300) AND "creator_source_intakes"."expires_at">"creator_source_intakes"."created_at")
);
--> statement-breakpoint
ALTER TABLE "creator_source_intakes" ADD CONSTRAINT "creator_source_intakes_draft_id_creator_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."creator_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_source_intakes" ADD CONSTRAINT "creator_source_intakes_source_id_creator_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."creator_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_source_intakes" ADD CONSTRAINT "creator_source_intakes_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_source_intakes_owner_idx" ON "creator_source_intakes" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_source_intakes_waiting_idx" ON "creator_source_intakes" USING btree ("workspace_id","user_id","session_id") WHERE "creator_source_intakes"."status"='waiting';